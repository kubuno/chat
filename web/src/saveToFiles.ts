// Filing a meeting recording in the recorder's own space.
//
// The file is written with the person's own session, so it lands in their own
// space with their own rights — nothing is done on their behalf with elevated
// privileges. The files module is discovered at runtime: when it is not
// installed the call simply fails, and the caller keeps the recording in the
// meeting's conversation instead. Nothing here assumes it is present.

import { api } from '@kubuno/sdk'

interface Folder { id: string; name: string; parent_id: string | null }

/** Finds the folder at the root of the person's space, or creates it. */
async function ensureRootFolder(name: string): Promise<string> {
  const { data } = await api.get<{ folders: Folder[] }>('/drive/folders')
  const found = (data.folders ?? []).find(f => f.parent_id === null && f.name === name)
  if (found) return found.id
  const created = await api.post<{ folder: Folder }>('/drive/folders', { name, parent_id: null })
  return created.data.folder.id
}

export interface SavedFile { fileId: string; folder: string }

/**
 * Writes `blob` into `folder` at the root of the person's space, creating the
 * folder on first use. Throws when there is no files module to write to.
 */
export async function saveToFiles(folder: string, blob: Blob, name: string): Promise<SavedFile> {
  const folderId = await ensureRootFolder(folder)
  const form = new FormData()
  form.append('folder_id', folderId)
  form.append('file', new File([blob], name, { type: blob.type || 'video/webm' }))
  const { data } = await api.post<{ file: { id: string } }>('/drive/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return { fileId: data.file.id, folder }
}
