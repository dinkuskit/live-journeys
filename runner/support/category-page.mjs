// How the product journeys judge a category page, with no browser, so the offline checks can test it.

/**
 * What's wrong with a category page that should no longer list this run's product, from its HTTP status
 * and whether it still lists it. Once the clean-up has moved a category the run made to the Trash, its
 * page may stop answering; a category the store's other products are in (`shared`) stays, so its page
 * must keep answering, as must any category page while the product is only archived.
 */
export function categoryHides({ path, status, listed, archived = false, shared = false }) {
  if (status !== 200) return archived || shared ? [`the category page ${path} answered HTTP ${status}`] : [];
  return listed ? [`the category page ${path} still lists it`] : [];
}
