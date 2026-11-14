import type { Metadata } from 'next'
import Editor from './editor'
import './editor.css'

export const metadata: Metadata = {
  title: 'html2any editor',
  description: 'Stream HTML in, edit it visually, export clean HTML.',
}

export default function EditorPage() {
  return <Editor />
}
