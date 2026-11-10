export function searchContent(items, query, category = '全部') {
  const terms = String(query ?? '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item => {
    if (category !== '全部' && item.category !== category) return false;
    const text = [item.title, item.summary, ...(item.body || [])].join(' ').toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  });
}
