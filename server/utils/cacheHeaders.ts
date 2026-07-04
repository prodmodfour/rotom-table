import { setHeader, type H3Event } from 'h3'

export const setPrivateNoStoreHeaders = (event: H3Event): void => {
  setHeader(event, 'cache-control', 'private, no-store, no-cache, must-revalidate')
  setHeader(event, 'pragma', 'no-cache')
  setHeader(event, 'expires', '0')
}
