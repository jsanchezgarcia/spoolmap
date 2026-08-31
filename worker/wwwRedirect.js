export default {
  fetch(request) {
    const source = new URL(request.url)
    const destination = new URL(source.pathname + source.search, "https://spoolmap.com")
    return Response.redirect(destination, 308)
  },
}
