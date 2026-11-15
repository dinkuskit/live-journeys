/**
 * Asks Commerce for this checkout's status until it leaves "pending". Status is also what makes
 * Commerce check the payment and record the order, so this runs even when the thank-you page cannot.
 * A read that got no answer (a dropped request, a 5xx, a refusal) is asked again within the same
 * 90 seconds, and the last answer Commerce did give is kept meanwhile. `read(page)` is checkout.mjs's
 * readStatus: { attemptId, checkout }, or { attemptId: null, unanswered: true } when Commerce gave no answer.
 * Imports nothing, so the offline checks run it without a browser.
 */
export async function settleCheckout(page, read) {
  const deadline = Date.now() + 90_000;
  let last = { attemptId: null };
  do {
    const answer = await read(page);
    if (!answer.unanswered) {
      last = answer;
      if (!last.attemptId || (last.checkout && last.checkout.state !== "pending")) return last;
    }
    await page.waitForTimeout(5_000);
  } while (Date.now() < deadline);
  return last;
}
