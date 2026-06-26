import { useStore } from '../state/store.jsx'
import CardsView from './CardsView.jsx'
import { PLACE_CONFIG } from './cardConfig.js'

export default function PlacesView() {
  const { places, createPlace, updatePlace, deletePlace, focusCard, consumeFocusCard } = useStore()
  return (
    <CardsView
      config={PLACE_CONFIG}
      items={places}
      onCreate={createPlace}
      onUpdate={updatePlace}
      onDelete={deletePlace}
      focusId={focusCard?.kind === 'place' ? focusCard.id : null}
      onFocusConsumed={consumeFocusCard}
    />
  )
}
