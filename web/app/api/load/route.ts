import { fetchHtmlUrl, LoadUrlError } from './fetch-html'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const value = searchParams.get('url')

  try {
    return Response.json(await fetchHtmlUrl(value))
  } catch (error) {
    if (error instanceof LoadUrlError) {
      return Response.json({ error: error.message }, { status: error.status })
    }

    return Response.json({ error: 'Could not fetch that URL.' }, { status: 500 })
  }
}
