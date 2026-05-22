import './globals.css'

export const metadata = {
  title: 'html2any',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
