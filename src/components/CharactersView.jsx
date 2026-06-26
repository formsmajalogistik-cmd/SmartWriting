import { useStore } from '../state/store.jsx'
import CardsView from './CardsView.jsx'
import { CHARACTER_CONFIG } from './cardConfig.js'

export default function CharactersView() {
  const { characters, createCharacter, updateCharacter, deleteCharacter, focusCard, consumeFocusCard } =
    useStore()
  return (
    <CardsView
      config={CHARACTER_CONFIG}
      items={characters}
      onCreate={createCharacter}
      onUpdate={updateCharacter}
      onDelete={deleteCharacter}
      focusId={focusCard?.kind === 'character' ? focusCard.id : null}
      onFocusConsumed={consumeFocusCard}
    />
  )
}
