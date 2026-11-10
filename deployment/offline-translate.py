"""Local, persistent M2M100 translation worker. JSON lines in; JSON lines out.

All inference resources are resolved below --root. This process never downloads
models and disables socket connections, including those made by dependencies.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
from pathlib import Path
import socket
import sys

LANGUAGES = ("zh-TW", "en", "ko", "ja", "de", "fr", "ru", "es", "ar", "pt", "it")
FIELDS = ("title", "summary", "source")
MAX_CONCURRENT_LANGUAGES = 2


def validate_request(value):
    if not isinstance(value, dict) or not isinstance(value.get("id"), str) or len(value["id"]) > 160:
        raise ValueError("invalid_request")
    article = value.get("article")
    languages = value.get("languages")
    if not isinstance(article, dict) or not isinstance(languages, list) or not languages or len(languages) > len(LANGUAGES):
        raise ValueError("invalid_request")
    if any(language not in LANGUAGES for language in languages) or len(languages) != len(set(languages)):
        raise ValueError("invalid_request")
    normalized = {}
    for field, limit in (("title", 100), ("summary", 400), ("source", 80)):
        content = article.get(field, "")
        if not isinstance(content, str) or len(content) > limit or (field == "title" and not content.strip()):
            raise ValueError("invalid_request")
        normalized[field] = content
    body = article.get("body")
    if not isinstance(body, list) or not 1 <= len(body) <= 1000 or any(not isinstance(part, str) or not part.strip() for part in body):
        raise ValueError("invalid_request")
    if sum(len(part) for part in body) > 50000:
        raise ValueError("invalid_request")
    normalized["body"] = body
    return {"id": value["id"], "article": normalized, "languages": languages}


def token_chunks(tokens, limit=240):
    """Keep all tokens, rather than asking the model to truncate long articles."""
    return [tokens[index:index + limit] for index in range(0, len(tokens), limit)]


def translate_languages(translate, article, languages, on_translation):
    """Translate a bounded number of target languages and report each success."""
    failed = False
    with ThreadPoolExecutor(max_workers=min(MAX_CONCURRENT_LANGUAGES, len(languages))) as executor:
        futures = {executor.submit(translate, article, language): language for language in languages}
        for future in as_completed(futures):
            language = futures[future]
            try:
                translation = future.result()
            except Exception:
                failed = True
                continue
            on_translation(language, translation)
    if failed:
        raise RuntimeError("translation_failed")


def forbid_network():
    def denied(*_args, **_kwargs):
        raise OSError("offline_translation_network_disabled")
    socket.create_connection = denied
    socket.socket.connect = denied
    socket.socket.connect_ex = denied


class OfflineEngine:
    def __init__(self, root):
        model = Path(root) / "model"
        if not all((model / name).is_file() for name in ("model.bin", "config.json", "shared_vocabulary.json", "sentencepiece.bpe.model")):
            raise RuntimeError("engine_unavailable")
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
        forbid_network()
        import ctranslate2
        import sentencepiece
        from opencc import OpenCC
        self.traditional = OpenCC("s2twp")
        self.tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(model / "sentencepiece.bpe.model"))
        self.translator = ctranslate2.Translator(
            str(model), device="cpu", compute_type="int8", inter_threads=MAX_CONCURRENT_LANGUAGES,
            intra_threads=max(1, min(4, (os.cpu_count() or 1) // MAX_CONCURRENT_LANGUAGES)))

    def translate(self, article, language):
        if language == "zh-TW":
            return {**{field: self.traditional.convert(article[field]) for field in FIELDS},
                    "body": [self.traditional.convert(part) for part in article["body"]]}
        values = [article[field] for field in FIELDS] + article["body"]
        inputs = []
        positions = []
        translated = [[] for _value in values]
        for position, value in enumerate(values):
            for chunk in token_chunks(self.tokenizer.encode(value, out_type=str)):
                positions.append(position)
                inputs.append(["__zh__"] + chunk + ["</s>"])
        target = "__" + language + "__"
        for start in range(0, len(inputs), 8):
            batch = inputs[start:start + 8]
            results = self.translator.translate_batch(batch, target_prefix=[[target] for _ in batch], beam_size=2,
                                                       max_batch_size=8, max_input_length=256, max_decoding_length=1024)
            for index, result in enumerate(results):
                tokens = result.hypotheses[0]
                if tokens and tokens[0] == target:
                    tokens = tokens[1:]
                content = self.tokenizer.decode([token for token in tokens if token not in ("</s>", "<s>", "<pad>")]).strip()
                if not content:
                    raise RuntimeError("translation_failed")
                translated[positions[start + index]].append(content)
        joined = [" ".join(parts) for parts in translated]
        return {**dict(zip(FIELDS, joined[:3])), "body": joined[3:]}


def emit(message):
    print(json.dumps(message, ensure_ascii=False, separators=(",", ":")), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent / "offline-translation")
    args = parser.parse_args()
    # The packaged Linux runtime keeps wheels beside the executable instead of
    # installing them globally; add that directory before importing libraries.
    runtime_site = Path(args.root) / "runtime" / ("windows-x64" if os.name == "nt" else "linux-x64") / "site-packages"
    if runtime_site.is_dir():
        sys.path.insert(0, str(runtime_site))
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    engine = None
    for line in sys.stdin:
        request_id = ""
        try:
            raw = json.loads(line)
            if isinstance(raw, dict) and isinstance(raw.get("id"), str) and len(raw["id"]) <= 160:
                request_id = raw["id"]
            request = validate_request(raw)
        except (ValueError, TypeError):
            emit({"id": request_id, "error": "invalid_request"})
            continue
        try:
            if engine is None:
                engine = OfflineEngine(args.root)
        except Exception:
            emit({"id": request_id, "error": "engine_unavailable"})
            continue
        try:
            translate_languages(
                engine.translate, request["article"], request["languages"],
                lambda language, translation: emit({"id": request_id, "language": language, "translation": translation}))
            emit({"id": request_id, "done": True})
        except Exception:
            # Never echo model exceptions: they can contain submitted article text.
            emit({"id": request_id, "error": "translation_failed"})


if __name__ == "__main__":
    main()
