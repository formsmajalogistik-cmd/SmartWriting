// Duplicate check for a new alias ("Aliase / weitere Namen"): any card's main
// name or alias, a region or geo-feature name, or an alias already on the SAME
// card. Duplicates are allowed — the #reference just becomes ambiguous — but
// never silently. Returns a German confirm() message, or null when unique.
// Shared by the full character/place card and the quick edit in the chapter's
// Figuren panel.
export function aliasWarning(value, { selfId, selfAliases = [], characters = [], places = [], regions = [], geoFeatures = [] }) {
  const v = (value || '').trim().toLowerCase()
  if (!v) return null
  const hits = []
  const scanCards = (rows, kindLabel) => {
    for (const r of rows) {
      if ((r.name || '').trim().toLowerCase() === v) hits.push(`${kindLabel} „${r.name}“`)
      const al = Array.isArray(r.card?.aliases) ? r.card.aliases : []
      if (r.id !== selfId && al.some((a) => (a || '').trim().toLowerCase() === v))
        hits.push(`Alias von ${kindLabel} „${r.name}“`)
    }
  }
  scanCards(characters, 'Figur')
  scanCards(places, 'Ort')
  for (const r of regions) if ((r.name || '').trim().toLowerCase() === v) hits.push(`Region „${r.name}“`)
  for (const g of geoFeatures) if ((g.name || '').trim().toLowerCase() === v) hits.push(`Geografie „${g.name}“`)
  if (selfAliases.some((a) => (a || '').trim().toLowerCase() === v)) hits.push('bereits Alias dieser Karte')
  if (!hits.length) return null
  return (
    `„${value.trim()}“ wird bereits verwendet: ${hits.join(', ')}. ` +
    `#Referenzen mit diesem Namen werden dadurch mehrdeutig. Trotzdem hinzufügen?`
  )
}
