import { useState } from 'react'

// Curated, dependency-free emoji set grouped by category. Covers the common
// ground without shipping the full Unicode table.
const CATEGORIES: { id: string; icon: string; emojis: string[] }[] = [
  { id: 'smileys', icon: '😀', emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥳','😏','😒','😞','😔','😟','😕','🙁','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕'] },
  { id: 'gestures', icon: '👍', emojis: ['👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','🤝','🙏','✍️','💪','🦾','👏','🙌','👐','🤲','🤜','🤛','✊','👊','🫶','🫰','🤌'] },
  { id: 'hearts', icon: '❤️', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','♥️','💯','🔥','⭐','🌟','✨','⚡','💥','💫','🎉','🎊','🎈','🎁'] },
  { id: 'animals', icon: '🐶', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦄','🐝','🦋','🐌','🐞','🐢','🐍','🐙','🦀','🐠','🐬','🐳','🐊','🐘','🦒','🦓','🐴','🐝'] },
  { id: 'food', icon: '🍕', emojis: ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🥑','🥦','🌽','🥕','🥔','🍞','🧀','🥐','🥨','🍔','🍟','🍕','🌭','🥪','🌮','🌯','🍜','🍝','🍣','🍱','🍰','🎂','🍪','🍫','🍩','☕','🍵','🍺','🍷','🥂','🍸'] },
  { id: 'activities', icon: '⚽', emojis: ['⚽','🏀','🏈','⚾','🎾','🏐','🏉','🎱','🏓','🏸','🥅','⛳','🏹','🎣','🥊','🥋','⛸️','🎿','🛷','🏂','🏋️','🤸','⛹️','🤾','🏌️','🏇','🧘','🏄','🏊','🚴','🎮','🎲','🎯','🎳','🎸','🎹','🎺','🎻','🥁','🎤','🎧','🎬','🎨'] },
  { id: 'travel', icon: '✈️', emojis: ['🚗','🚕','🚙','🚌','🏎️','🚓','🚑','🚒','🚐','🚚','🚛','🚲','🛴','🏍️','✈️','🚀','🛸','🚁','⛵','🚤','🛳️','🗺️','🗽','🗼','🏰','🏯','🎡','🎢','🎠','⛱️','🏖️','🏝️','⛰️','🌋','🗻','🏕️','🌅','🌄','🌃','🌆','🌇'] },
  { id: 'symbols', icon: '💬', emojis: ['💬','💭','🗯️','♻️','✅','❌','❓','❗','⚠️','🚫','💲','✔️','➕','➖','➗','💢','💤','🔔','🔕','🔒','🔓','🔑','⏰','⌛','💡','🔦','📌','📍','📎','✂️','🔍','❤️‍🔥','💀','👻','👽','🤖','🎃','😺','🙈','🙉','🙊'] },
]

export default function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose?: () => void }) {
  const [cat, setCat] = useState(0)
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-xl w-[280px] flex flex-col overflow-hidden" onMouseLeave={onClose}>
      <div className="flex items-center border-b border-gray-100 px-1">
        {CATEGORIES.map((c, i) => (
          <button
            key={c.id}
            onClick={() => setCat(i)}
            className={`flex-1 py-1.5 text-lg rounded ${i === cat ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
            title={c.id}
          >
            {c.icon}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-8 gap-0.5 p-2 max-h-[200px] overflow-y-auto">
        {CATEGORIES[cat].emojis.map((e, idx) => (
          <button key={e + idx} onClick={() => onPick(e)} className="text-xl hover:bg-gray-100 rounded p-0.5 transition-colors">
            {e}
          </button>
        ))}
      </div>
    </div>
  )
}
