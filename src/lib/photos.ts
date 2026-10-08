import { supabase } from './supabase'

export async function uploadPetPhoto(userId: string, file: File) {
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'
  }
  const ext = extensions[file.type]
  if (!ext) throw new Error('Choose a JPG, PNG, or WebP pet photo.')
  if (file.size > 8 * 1024 * 1024) throw new Error('The pet photo must be 8 MB or smaller.')
  const path = `${userId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('pet-photos').upload(path, file, { upsert: false })
  if (error) throw error
  const { data } = supabase.storage.from('pet-photos').getPublicUrl(path)
  return data.publicUrl
}
