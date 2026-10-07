// Instance administration of chat, rendered in the core admin console under
// Modules ▸ Chat. Chat is end-to-end encrypted, so the honest first thing an
// administrator must see is what that rules OUT — the server holds only
// ciphertext. This banner states it plainly on the "overview" page; the actual
// levers (retention, media size) are ordinary settings on the other pages.

import { ShieldCheck } from 'lucide-react'
import { ModuleAdminRegistry } from '@kubuno/sdk'

function E2EBanner() {
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-5 mb-4">
      <div className="flex items-start gap-3">
        <ShieldCheck size={20} className="text-success shrink-0 mt-0.5" />
        <div className="space-y-2 text-sm text-text-secondary">
          <p className="text-text-primary font-medium">Chiffrement de bout en bout</p>
          <p>
            Les messages sont chiffrés de bout en bout (protocole Signal). Le serveur
            ne détient que du texte chiffré : <strong>l'administrateur ne peut ni lire,
            ni modérer, ni filtrer les messages par leur contenu.</strong>
          </p>
          <p>
            Les leviers d'administration sont donc <strong>structurels</strong>, jamais fondés
            sur le contenu : durée de conservation et auto-destruction (suppression du chiffré
            au-delà d'un délai), taille maximale des médias, activation du partage de fichiers
            et des aperçus de liens, politique d'espaces et de comptes invités.
          </p>
          <p>
            Certaines fonctions d'autres plateformes sont <strong>volontairement absentes</strong> :
            archivage légal / eDiscovery, mise sous séquestre, conservation « avec consultation »,
            lecture ou modération des messages par un administrateur, filtrage par contenu ou par
            type de fichier — le type est déclaré par le client et n'est pas vérifiable. Aucune
            n'est réalisable sans casser le chiffrement de bout en bout ; ce sont des choix, pas
            des oublis.
          </p>
        </div>
      </div>
    </div>
  )
}

/// Registers the chat admin sections into the core console.
export function registerChatAdmin() {
  ModuleAdminRegistry.register({
    moduleId:  'chat',
    id:        'e2e-banner',
    group:     'overview',
    position:  10,
    Component: E2EBanner,
  })
}
