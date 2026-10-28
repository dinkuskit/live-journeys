# DinkusKit live test runner

Saved Playwright journeys against a live test store and the live services. Each
journey is one spec file in [tests](tests/), tagged with its stage in the
journeys plan:

| Journey | Stage | What it covers |
| --- | --- | --- |
| [Install the Registry plugins](tests/01-install-plugins.spec.mjs) | `@running` | A DinkusKit beta the beta store does not already run is installed there (`dinkus-ship-beta` `0.1.0-beta.1` unless `DINKUS_E2E_INSTALL` names others), through the store's Registry verify and install routes, and Plugins lists it. A beta the store already runs is left as it is |
| [DinkusKit.com account and connect the store](tests/02-connect-dinkuskit.spec.mjs) | `@running` | The owner's DinkusKit.com account and the beta store connected there. From Commerce's Connect release that means Commerce connected: Commerce Settings shows it connected to this store, or, when it isn't, Connect there and Approve commerce at DinkusKit.com, and Your Stores then lists Commerce connected. Before that release, when the account says to connect the store, Payments status is used to approve Payments for that store only. Disconnect, Replace key and Show checkout settings are never pressed |
| [Payments status](tests/03-payments-status.spec.mjs) | `@running` | On the beta store, dinkus-payments-beta's Payments status shows a connected Stripe test account, or, only when the store is not connected at all, walks Connect, Authorize Payments at DinkusKit, Approve payments, Continue and Check connection. From Payments 0.3.0 the page must show Connected: Stripe test mode when it opens, checked with a Store key: in 0.3.0 the one the owner pasted in the plugin's settings, where a page that asks for the store key fails; from Payments' Connect release the plugin's own, so a page that says to select Connect again gets Connect again and Approve payments once. A page that shows only its last check or offers Sign in again fails. Deny, Reconnect, Sign in again and Stripe setup are not pressed, Check connection only follows this run's own approval, and the journey never types a key |
| [Commerce settings](tests/04-commerce-settings.spec.mjs) | `@running` | Commerce's settings form shows Checkout settings and an empty Store key, with the Set up Commerce descriptions. From Commerce's Connect release the form holds only an empty DinkusKit connection, Commerce Settings shows Commerce connected to this store (Connect and Approve commerce on the beta store when it isn't), and on the beta store Get checkout settings brings this store's checkout settings, which DinkusKit.com gives only once Payments is connected. First, the same Connect, run as it would be on any other store, must press nothing. Nothing is typed |
| [Ship settings](tests/05-ship-settings.spec.mjs) | `@running` | Ship's settings show Store ID matching the store's site id and an empty Store key. From Ship's Connect release the form holds only an empty DinkusKit connection, and the Shipping page is connected to this store (Connect and Approve ship on the beta store when it isn't, once Commerce is). First, the same Connect, run as it would be on any other store, must press nothing. Nothing is typed, and no label is bought |
| [Buy and ship](tests/buy-and-ship.spec.mjs) | `@running` | A Stripe TEST order on the store, the order in Commerce, a Pitney Bowes sandbox label in Ship, and Commerce marking the order Completed with the same tracking number |
| [Storefront](tests/storefront.spec.mjs) | `@running` | A new shopper's first look: the homepage, the product list, a product page and its category page |
| [Cart](tests/cart.spec.mjs) | `@running` | A new shopper adds a product to the cart, changes its quantity and removes it, with the cart total right each time |
| [Manage products](tests/manage-products.spec.mjs) | `@running` | On the one product screen (a Content > Products page with its Dinkus Commerce and Product image & gallery panels), the owner adds a product page in a category the store's other products are in (Full catalog's caps), gives it price and stock, sees the Draft stay off the store, gives it a photo that stays after a reload, publishes the page to put it on sale, changes its price and name, and archives and restores it, with the store following each change |
| [Full catalog](tests/full-catalog.spec.mjs) | `@running` | The store carries a catalog as big as a real shop's (3 categories of 8 products unless set otherwise), each product with its own price, weight, photo and page: the owner adds what's missing on each product's page and its Dinkus Commerce panel, the Shop list, every category page and every product page show the whole catalog, and the owner can still save a product with all of it in place |
| [Mark as completed](tests/mark-completed.spec.mjs) | `@running` | The owner marks a paid TEST order completed in Commerce Orders, typing a carrier and tracking number, and an agent completes another through Commerce's orders API, sending neither; both end Completed |
| [Problems](tests/problems.spec.mjs) | `@running` | A shopper's checkout going wrong: Stripe turns down a declined card, a card without enough funds and a card that fails the bank's security check, each with a clear message and no order; the shopper leaves Stripe for the cart, finds the way back to the same checkout, pays once with the test card and closes the tab, Commerce makes the order on its own, and the owner completes that one order |
| [Buy a label in the store admin](tests/store-admin-label.spec.mjs) | `@running` | The owner ships a paid Stripe TEST order from the store admin's Shipping page, which the Ship plugin draws from hosted Ship: See prices, Buy label at the quoted price and Print label, then, once Commerce has completed the order, Print label again and Cancel label, with the order staying Completed |
| [One product with a category](tests/onboarding-product.spec.mjs) | `@running` | The owner adds one product page in a new category, gives it price and stock and a weight in its Dinkus Commerce panel and a photo in its Product image & gallery panel, and publishes it, which puts it on sale. Archive is only the tidy afterward, not the story |
| [An agent manages a product](tests/agent-products.spec.mjs) | `@next` | An agent with only an EmDash key makes a Draft product and its page through Commerce's catalog API and EmDash's content API, the page in a category the store's other products are in (Full catalog's tees), publishes the page to put it on sale, changes its price from a preview, sees Commerce refuse a change made from an old preview, and archives it, with the store following each change |
| [Free shipping over an amount](tests/free-shipping.spec.mjs) | `@next` | With the store on a flat shipping charge and a free-shipping amount, set once on DinkusKit.com's Your Stores page and only read by the journey, one Stripe TEST order under the amount pays the flat charge and one whose goods reach the amount pays no shipping: on Stripe, on the thank-you page and in Commerce Orders. Both orders end Completed |

`npm test` runs every `@running` journey, one at a time in file-name order, so
the five numbered setup journeys run first and the store is connected before
anything is bought. Payments status runs before Commerce settings, because
DinkusKit.com gives Commerce its checkout settings only once Payments is
connected. A new journey starts as `@next` and moves to `@running` once it has
passed on the beta store.

From the Connect releases of Commerce, Payments and Ship nothing is pasted: each
plugin gets its own store key when the business owner approves its Connect at
DinkusKit.com. On the beta store a run presses Connect once in each plugin that
isn't connected yet, signed in to the store admin as an Administrator, and
approves it on DinkusKit.com's "Connect this store?" page with the account's
emailed sign-in link. Commerce connects first, because its Connect registers the
store, and Ship's Connect is refused until it has. Approve is pressed only when
that page names this store and this plugin; just before, the same check is tried
as another store and as each other plugin, and must refuse. Just after, the run
opens the same approval link again, and DinkusKit.com must say it is no longer
waiting for consent, with no Approve. Each setup journey tells the
releases apart by what its page shows, so it passes on the release before Connect
too. Manage products, Full catalog and One product with a category need a
Commerce with the Dinkus Commerce panel on Content > Products pages
(0.6.0-beta.1 or later, the one product screen); before it Commerce had a
Products page of its own, which these journeys no longer drive, so on an older
Commerce they fail at their first panel step and Full catalog adds nothing. A
product the panel makes is a Draft until its page is published, and only the
store's publish check (template-store#152) puts it on sale; on a store without
that check, the steps that publish a page and expect its product on sale fail,
and so does every later store check of that product. Buy a label in the store admin needs the Ship
plugin installed and connected, as dinkus-ship-beta is on the beta store, where
it first passed on 20 Oct.

How a beta becomes that release is [Release a plugin](../SKILL.md#release-a-plugin).
Payments, Commerce and Ship each press `cut-beta`, then this workflow, then
`promote`. This runner proves. It does not
publish. **Update the store** does not install a plugin the store is not already
running. [Install the Registry plugins](tests/01-install-plugins.spec.mjs) does that,
and only on beta.sm0ky.dev. It never types a store key.

It runs in a visible Chrome window with its own saved profile
(`~/.dinkus-e2e/profile`), so sign-ins carry over between runs. DinkusKit.com
signs in with an emailed link, and the Cloudflare Access app in front of the
store admin (or of the whole test store) signs in with an emailed one-time PIN.
The test reads both emails itself through the mail command, so nobody has to
step in. It takes only Access emails that name the store's address, so it never
types a code another store sent to the same inbox. The Access app must offer
One-time PIN: the request filter below blocks other sign-in providers such as
Google, so a Google-only Access app can't be signed in to from a run, not even by
hand with `DINKUS_E2E_ADMIN_SIGNIN=wait`.

## Requests stay within the selected sites

Pages the canonical journeys open filter requests to the selected `DINKUS_E2E_STORE`,
the DinkusKit.com and Ship set by `DINKUS_E2E_ACCOUNT` and `DINKUS_E2E_SHIP` (the
live ones unless set), Stripe/Stripe CDN, and the exact Access origins
listed in `DINKUS_E2E_ACCESS_ORIGINS`. Other stores and lookalike domains are
blocked. Store photos may use any dimensions or query parameters; the filter
checks the origin, not a fixed image-size list. Service workers are disabled so
they cannot bypass the browser request filter, and WebSocket connections to other
hosts are closed before they connect.

When the store sends visitors to a Cloudflare Access sign-in that
`DINKUS_E2E_ACCESS_ORIGINS` doesn't list, the run stops before its first page and
names the origin to add, since the filter would block that sign-in. Shopper
windows check only the storefront, so a journey that never opens the admin isn't
stopped by an admin-only Access app.

Popups the site opens and cross-site frames (Stripe's) get the same origin check and
lose store headers on every request they start. Redirects are where they differ:
Chromium shows a cross-site frame's redirects to no interceptor the runner can attach,
and a popup's interceptor attaches only after its first request has left, so a redirect
answering a cross-site frame's request, or a popup's first one, is not checked. Later
requests and redirects in a popup are.

Store authorization headers are removed from requests to other allowed sites;
those sites use their own browser cookies. Chromium pauses every network hop, including redirects, for the origin check;
headers are scoped again at each destination. The filter never
adds credentials. Direct link, photo and PDF probes use the same origin policy and check each
redirect before following it. The agent's separate store API calls retain their
existing same-store URLs and manual-redirect behavior.

Playwright turns the browser's cache off while the filter is on, so each browser
the run opens keeps its own copy of each store file the store marks immutable (the
hashed scripts and styles under `/_astro/`) and answers repeat requests from it while
the store says it stays fresh, as a shopper's browser would. A new shopper's browser
starts with none. Without this, every page view fetches them all again, and a run
can cross the store's limit of 120 requests a minute per visitor.

That limit counts every request from one address, pages, photos and admin calls
alike, from every browser the run opens. So the run counts its own store requests
from the moment each is sent, and before a step that sends many (opening a store
page with its photos or a page of the store admin, reading each product's photo or
link, uploading a photo to the Media library, the owner's work on a product in Full
catalog) it waits until they fit under 100 in the last minute. The count carries on when Playwright starts
a new worker after a journey fails, and into a run started straight after another:
each store request's time also goes, as it's sent, in that minute's log
(`.store-requests-<store>-<minute>.log`) beside the run folders in
`DINKUS_E2E_PROOF`, which takes it back if the browser answered it from its own
copy. Each new worker counts the last minute's requests from those logs, and logs
older than the last minute are removed as the run goes. On a store with a few
products it never waits; with a large catalog it slows down rather than being
turned away.

Leave the window alone while it runs: the test drives it, and a click or a tab
of yours can get in its way. To see the label, look in the proof folder for
`label.pdf` and its picture; Buy and ship also shows the picture in the window.
Every click, page load and screenshot has a time limit, so nothing holds a run
for long: a step whose page stops answering fails within a minute or two.

## Run

```sh
npm ci
npm test                      # every @running journey; Buy and ship goes from checkout to Completed
npm run journey -- storefront # one journey, by its file name (storefront, cart, manage-products, full-catalog, mark-completed, problems, buy-and-ship, store-admin-label, install-plugins, connect-dinkuskit, commerce-settings, payments-status, ship-settings, onboarding-product)
npm run finish                # Buy and ship from an existing order (DINKUS_E2E_ORDER=1001, or the only unfinished TEST order)
npm run unit                  # the runner's own offline checks
npm run update-store          # beta.sm0ky.dev only: update its DinkusKit beta plugins to the newest betas
```

Storefront opens its own clean browser, with no sign-ins, cookies or saved
cart, so it sees exactly what a new shopper sees. When the test store keeps
every page behind Cloudflare Access, that browser first signs in to Access with
an emailed one-time PIN, as the admin sign-in does, and to nothing else. It
needs `DINKUS_E2E_STORE`, plus the mail command and `DINKUS_E2E_OWNER_EMAIL`
when Access fronts the store.

Cart opens its own clean browser the same way. It adds one product to that
browser's cart, changes it and removes it again, and never checks out, so it
places no order and leaves nothing behind in the store.

Manage products works in the store admin with the saved profile, as an owner
does: the product page's editor with its Dinkus Commerce panel in one tab,
EmDash's Media library and categories in another. After each change it checks the store in a clean shopper browser. Its
photo is one the browser draws for each run, labeled with the product's name, so
every run uploads a file of its own: the Media library keeps one copy of
identical files, under the first one's name. It tidies up
after itself, but Commerce archives products rather than deleting them, so each
run leaves one archived product named "Live test product <date and time>
renamed" and its photo in the Media library. Its product page and category go
to EmDash's Trash.

Full catalog keeps a standing catalog on the store, so every journey runs
against a store with as many products as a real shop: categories named "Catalog
Tees", "Catalog Hoodies" and "Catalog Caps", each holding products named
"Catalog Tee 01" and so on, every one with its own price, weight, photo and
published page. `DINKUS_E2E_CATALOG` sets the size, as categories x products per
category (`3x8` unless set, up to `4x50`). The first run on a store adds the
whole catalog as an owner would, on each product's page and its Dinkus Commerce
panel, in the Media library and in EmDash's categories, which takes about a minute a product; later runs find
it there, add only what's missing, and spend about four minutes checking it. A
bigger catalog gets more time before the journey times out: ten seconds for
each product it checks, and two minutes for each it adds. The catalog stays on
the store: Commerce archives products rather than deleting
them, so taking it off each run would leave a pile of archived products behind.
Before Commerce 0.3.0-beta.4, each product screen read the whole catalog, so a
store with more than a handful of products couldn't save a product; on a store
running an older Commerce the journey adds nothing and says so.

Mark as completed places two Stripe TEST orders the way Buy and ship places
one, paying each once with the test card, and leaves both Completed. The owner
completes the first in Commerce Orders. For the second, the test makes an admin
key with the saved profile's admin sign-in, set to stop working after an hour,
and the agent completes the order with that key alone. The test deletes the key
at the end of the run, even after a failed step. The key only ever travels in
the test's own calls, never through the browser, so it can't reach the proof.
When Cloudflare Access fronts the store's API as well as
its admin, the agent's calls also carry the saved Access sign-in, as an agent's
Access service token would. To complete existing Processing TEST orders instead
of placing new ones, set `DINKUS_E2E_ORDERS_TO_COMPLETE` (the owner's order,
then the agent's).

An agent manages a product works as any agent can, with an admin key made and
deleted the way Mark as completed does it and no browser: Commerce's catalog API
(`POST catalog`, beside the orders API) for the product, EmDash's content API for
its page, and EmDash's schema API to learn what a product page needs. It adds one
product and page named "Live agent product" with the run's date and time, and
takes both off the store at the end: the product archived, the page in EmDash's
Trash. A store whose product pages still require placeholder art gets `TEE`.
It needs a Commerce with the catalog API (0.7.0 and later).

Problems works in one Stripe TEST checkout and places one order. On Stripe's
hosted Checkout it tries three of Stripe's test cards that never take a payment:
4000 0000 0000 0002 (declined), 4000 0000 0000 9995 (not enough funds) and
4000 0027 6000 3184, which brings up Stripe's test bank check, where the test
presses Fail, and again if Stripe's test page is still open seconds later.
Then it leaves by Stripe's link back to the store, which Payments
points at the cart (from payments#79, at the store's checkout page), follows
that page's way back to the same checkout and pays once with the 4242 test
card, then closes the tab before Stripe's redirect reaches the store, so no
store page asks Commerce about the checkout; Commerce's background check (woken
by Payments, or its 5-minute schedule) has to make the order on its own within
`DINKUS_E2E_COMPLETE_WAIT_SECONDS`. The owner completes the order in Commerce Orders, so the run leaves no
order open. If Stripe takes a payment from a card it should turn down, the test
pays nothing more and checks and completes that order instead. On a store whose
cart offers no way back to an open checkout (Template Store before #100), the
way-back step fails and the test pays through the checkout's own Stripe page,
as Buy and ship does with a checkout an earlier run left open. A store without
the checkout page Payments names (Template Store before #127) fails the back-link
step, and the test checks the cart's way back instead.

Buy a label in the store admin places one Stripe TEST order the way Buy and ship
does, paying once with the test card, and buys one Pitney Bowes sandbox label
for it on the store admin's Shipping page, which charges nothing. Commerce
completes the order with the label's tracking number, and the journey cancels
the label at the end, so the run leaves the order Completed and its label
cancelled, listed under Earlier labels. When a step before Cancel label stops
the journey, the label stays bought: it's a sandbox label, so nothing was
charged, and Commerce still completes the order with it. It needs the Ship
plugin installed and connected (the store's Store ID and store key in its
settings), and hosted Ship running on Pitney Bowes's sandbox, which is when Ship
gives TEST orders sandbox labels. It finds the Shipping page in the admin's menu;
when the menu has more than one, set `DINKUS_E2E_SHIPPING_ADMIN`.

Free shipping over an amount needs the store set once on DinkusKit.com's Your
Stores page: Shipping charge "Flat amount in dollars" above $0.00 and a
free-shipping amount (75.00, say), then Save checkout settings. The same form
holds the Payments Test/Live choice, so the journey only reads it, signed in as
the owner, and stops at its first step when the store isn't set that way. Keep
the amount above any one product's price, so the other journeys' one-item
orders pay the flat charge. Commerce reads a saved change within 5 minutes, and
from Commerce 0.7.0 charges no shipping once an order's goods reach the amount.
The journey places two Stripe TEST orders the way Buy and ship places one: one
item under the amount, then the fewest of the same product whose goods reach it,
typed into the cart's quantity box (up to 99). The owner completes both in
Commerce Orders, so the run leaves no order open.

From Payments' and Ship's sidebar folder changes, their menu pages sit in
EmDash sidebar folders: Payments status is "Payment settings" in "Dinkus
Payments", and the Shipping page is "Shipments" in "Dinkus Ship", with the same
addresses. A folder is drawn closed until it's opened, and a closed folder
hides its links, so a journey that looks for either page opens its folder
first when the menu shows it closed, and takes either name. The beta store also
runs Payments' release listing, still "Payments status" with no folder until
its next release.
Print label's link shows the label to anyone who has it, for five minutes, so
the test reads it with its own fetch and writes it in no note or error. For the
same reason the journey leaves a blank page behind it, so Playwright's notes on
a failure can't show the link either; its step screenshots and notes are its
proof.

The machine's settings come from `~/.dinkus-e2e/env`; see
[setup](../references/setup.md).

## Run on GitHub

The repository's **Live journeys** workflow (`.github/workflows/live-journeys.yml`) runs
the same journeys on a GitHub runner against the beta test store, beta.sm0ky.dev, with
no Mac. Press **Run workflow** on its Actions page; `@running` runs every Running journey. That store
belongs to the workflow alone. Runs go one at a time: a press while a run is going waits its
turn, and a further press replaces the waiting one.

Before the journeys, **Update the store** (`tests/update-store.spec.mjs`, `npm run update-store`)
moves each DinkusKit beta plugin the store runs (dinkus-commerce-beta, dinkus-payments-beta and
so on) to the newest beta the Registry has, one at a time and in place, as the Update button on
the admin's Plugins page does; the journeys run only once it has passed. It refuses any store
but beta.sm0ky.dev, leaves every other plugin alone, never moves a plugin back to an older
version or between its beta and release listings, and agrees to nothing the Update button would
ask about: an update that asks for new permissions, opens routes to visitors who aren't signed
in (which also need an exception in the store's Access app) or changes its agent tools stops the
run, naming the plugin and what it asked, for the owner to update by hand. Commerce's and Ship's
Connect releases each open one such route, `store-proof`, which DinkusKit.com reads while the
owner approves that plugin's Connect, so the first run on each stops here until the owner has
updated it by hand and the Access app lets DinkusKit.com reach that route. It also stops when
EmDash couldn't check the Registry for a plugin, since a pass has to name the betas it really
tested. When a plugin's **Cut beta** presses Run workflow, it names the beta it just published
(the `beta` input, such as `dinkus-payments-beta 0.2.9-beta.3`, shown in the run's name), and the
update first waits up to 15 minutes for the Registry to offer it, then installs exactly that beta,
even if a later one is out (and stops if the store already runs a later one). Only `npm run update-store`
runs it; every other run leaves it out. Untick "update_store" on **Run workflow** to test what the
store already runs.

Chrome runs headless, so the runner fails at once wherever it would wait for a person. Sign-in emails are read with
`scripts/gmail-mail.mjs`, through the Gmail API with a read-only key, in place of gogcli.
The job log is public, so it shows only each journey's pass or fail, the plugin versions
the store ran ("Plugins tested"), so a release can check its own beta passed, why the
store update stopped, if it did, and, for a journey that failed, its step names with each
step's pass or fail and one fixed kind of failure ("timed out after 30 s", "an expect check
failed"; never the error's own words); what each step found,
screenshots, console output and any video go to a private R2 bucket under
`runs/github-<run id>-<attempt>/`.

It needs these repository secrets:

| Secret | What it is |
| --- | --- |
| `DINKUS_E2E_GMAIL_CLIENT_ID`, `DINKUS_E2E_GMAIL_CLIENT_SECRET`, `DINKUS_E2E_GMAIL_REFRESH_TOKEN`, `DINKUS_E2E_OWNER_EMAIL` | The test inbox's read-only key. `node scripts/gmail-authorize.mjs <client_secret.json> <inbox>` makes it once, from a Google OAuth client of type "Desktop app", and saves all four with `gh secret set` without printing them |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | A private R2 bucket for the proof, and an R2 API token that can only read and write that bucket |

## Settings

Set these in `~/.dinkus-e2e/env` (or the file `DINKUS_E2E_ENV_FILE` names), or in
the environment, which wins.

| Setting | Default | What it is |
| --- | --- | --- |
| `DINKUS_E2E_STORE` | required | The store's address |
| `DINKUS_E2E_SITE_ID` | required | The store's DinkusKit site id |
| `DINKUS_E2E_OWNER_EMAIL` | required | The owner's DinkusKit.com address; the test asks for sign-in emails to it |
| `DINKUS_E2E_MAIL_ACCOUNT` | none | The test inbox; picks the bundled read-only `scripts/gog-mail.sh` |
| `DINKUS_E2E_GOG_CLIENT` | gogcli's default | A named gogcli OAuth client for that inbox |
| `DINKUS_E2E_MAIL_CMD` | the gogcli script | Any command that prints the bodies of the messages matching `$DINKUS_MAIL_QUERY`, newest first, such as `node scripts/gmail-mail.mjs` with the Gmail key from "Run on GitHub" |
| `DINKUS_E2E_GMAIL_CLIENT_ID`, `DINKUS_E2E_GMAIL_CLIENT_SECRET`, `DINKUS_E2E_GMAIL_REFRESH_TOKEN` | none | The test inbox's read-only Gmail key, for `scripts/gmail-mail.mjs` |
| `DINKUS_E2E_ACCESS_MAIL_QUERY` | Cloudflare's senders, last hour, naming the store's address | The Gmail search for the Access code email; set it when your Access emails don't name the store's address |
| `DINKUS_E2E_ACCESS_ORIGINS` | none | Comma-separated exact HTTPS Cloudflare Access origins for this store (for example `https://your-team.cloudflareaccess.com`). Other Access tenants are blocked. |
| `DINKUS_E2E_SHOPPER_EMAIL` | the owner's address | The checkout contact |
| `DINKUS_E2E_PRODUCT_PATH` | the first shippable product | The product page to buy |
| `DINKUS_E2E_SERVICE` | `GA` | The label service (Ground Advantage) |
| `DINKUS_E2E_COMPLETE_WAIT_SECONDS` | `420` | How long to wait for Commerce's background check |
| `DINKUS_E2E_ORDERS_ADMIN` | the Registry Commerce plugin's Orders page | Commerce Orders in the store admin |
| `DINKUS_E2E_SHIPPING_ADMIN` | the admin menu's Shipping page ("Shipments" in the Dinkus Ship folder, or "Shipping") | The Ship plugin's Shipping page in the store admin, for Buy a label in the store admin |
| `DINKUS_E2E_CATALOG` | `3x8` | For Full catalog, the standing catalog's size as categories x products per category, from `1x1` to `4x50` |
| `DINKUS_E2E_ORDERS_TO_COMPLETE` | new orders | For Mark as completed, one or two different Processing TEST orders for the owner and then the agent to complete (`1003,1004`) instead of placing new ones. Anything else stops the journey before it places or completes an order |
| `DINKUS_E2E_ADMIN_SIGNIN` | `skip` | `wait` lets a person sign in to the store admin |
| `DINKUS_E2E_PROOF` | `~/.dinkus-e2e/proof` | Where each run's proof folder goes |
| `DINKUS_E2E_PROFILE` | `~/.dinkus-e2e/profile` | The saved Chrome profile |
| `DINKUS_E2E_HEADLESS` | off | `1` hides the window |
| `DINKUS_E2E_VIDEO` | off | `1` records every browser window the run opens, as a video in its proof folder |

Without a mail command, the test waits for a person to sign in in the window.

## What it proves

### Buy and ship

| Step | What it proves |
| --- | --- |
| Place a Stripe TEST order on the store | A shopper can add a physical product to the cart and pay on Stripe's hosted Checkout with the test card |
| The thank-you page confirms the order and empties the cart | After Stripe sends the shopper back, the store's own page shows the confirmed order (pressing "Check status again" while it says pending, as a shopper would) and the header cart is empty. Recorded before the test asks Commerce itself, so the page gets no help |
| Commerce Orders shows the paid TEST order | Commerce recorded the order as TEST, provider-paid and Processing. Orders lists its orders by order ID, 25 to a page, so the test finds this checkout's order by its order ID on whichever page it is, as Mark as completed does. Skipped when Commerce's checkout status names no order; Ship's only unfinished TEST order then stands in |
| Ship has the order | Commerce sent the order to Ship |
| Make the Pitney Bowes sandbox label | Ship quotes sandbox prices and buys a sandbox label. The test works on Ship's own page for the order (`?view=full`), since once the store's Ship plugin has called Ship, the order's plain address goes on to the store admin's Shipping page |
| Label is a TEST SANDBOX label with a tracking number | The label is a sandbox label, not a practice one, and carries a tracking number |
| Label PDF downloads and renders | Ship serves the provider's PDF, and its first page draws as a picture of the label, shown in the browser for the step's screenshot and the video |
| Commerce's 5-minute check collects the label | Commerce's background check collects the label without anyone opening the store admin |
| Opening Commerce Orders collects the label | Runs only when the check above didn't: an owner opening Commerce Orders collects it |
| Commerce marks the order Completed with the same tracking | Ship shows Commerce completed the order with the label's tracking number |
| Commerce Orders shows Completed in the store admin | The store admin agrees: the order's page shows it Completed with carrier USPS and the label's tracking number |

### Storefront

Every step after the first is soft: a finding is recorded and the journey goes
on, so one run lists everything a shopper would trip over.

| Step | What it proves |
| --- | --- |
| A new shopper can open the store | The homepage answers HTTP 200 on the store's own address, after a Cloudflare Access sign-in when the test store keeps every page behind one. When it doesn't, the journey stops here, since nothing else can be checked |
| The homepage shows no developer notices | The homepage shows no error box: no "Storefront composition is unavailable", no unknown content block, no alert |
| The product list shows each product's name, price and photo | Every product in the Shop list shows shoppers a name, a price and its own photo that loads (the store's placeholder, "No image", or a name, price or photo the page hides fails) |
| Every product in the list opens its own page | Each product's link answers HTTP 200 |
| The product page shows the name, price and photo and offers Add to cart | The first product's page (or `DINKUS_E2E_PRODUCT_PATH`) shows its name, price and photo, and its Add to cart button is ready |
| A category page lists its products with name, price and photo | The product's category page (or the first one the homepage links) lists products with names, prices and their own photos, each opening its product page. Skipped when no category page is linked |
| No page says checkout is unavailable on a store that takes checkouts | When the store takes checkouts (its cart page admits guest checkout), the homepage, the product page, the category page and the empty cart don't tell shoppers they can't check out or buy. Skipped, with the reason, when the cart page says the store takes none; a cart page that won't open or doesn't say fails it |

### Cart

Once the product is in the cart every step is soft, so one run lists every
finding.

| Step | What it proves |
| --- | --- |
| A new shopper can open the store | As in Storefront. When it doesn't, the journey stops here |
| Add to cart puts the product in the cart | The first product in the Shop list with a working Add to cart (on its own page, or on its Shop card when it has no page; or `DINKUS_E2E_PRODUCT_PATH`) says "Added to cart", the header's cart shows 1 item, and the cart page lists the product once, under the name and at the price the shopper saw, quantity 1. When it doesn't, or the product shows no price to compare, the journey stops here, since the cart has nothing to check |
| The cart total matches the item's price | The cart shows a subtotal (or a total) equal to the line's price times its quantity |
| Changing the quantity updates the cart | Typing 2 in the quantity field and moving on updates the header's cart to 2 items, and the cart still shows 2 after a reload |
| The cart total follows the new quantity | The cart's subtotal (or total) is the price times 2 as soon as the quantity changes, before any reload |
| Removing the item empties the cart | Remove leaves no lines, the cart says it is empty and the header's cart shows no items, and all three still hold after a reload |

### Manage products

Its first three steps stop the journey when they fail, since nothing after them
can run; every later step is soft. After each change the journey reloads the
store's pages until they show it, for up to a minute, and says how long the store
took. The price, name and restore steps look for the photo too, until a step
finds the store showing the product wrong, so a photo the store lost fails the step
that first misses it while each later step still reports on its own change and
says it didn't look for the photo. Whatever the run added comes off the store at
the end, even after a failed step.

| Step | What it proves |
| --- | --- |
| The owner opens Content > Products | Content > Products opens in the store admin with its list of product pages, and the run notes the plugin versions |
| The owner adds a product page in a category with other products | The owner adds a product page drawn as a cap, puts it in Full catalog's published "Catalog Caps", as a shop files a new product beside the ones like it, and saves it, unpublished. A store without "Catalog Caps" gets a category of the journey's own instead, made and published in EmDash, and the run notes it. When it can't, the journey stops here |
| The owner adds price and stock with a price and a weight | In the page's Dinkus Commerce panel the owner types a SKU and presses Add price and stock, applies the change EmDash asks about and saves the page, which then keeps the product's ID in its Commerce product field. The panel shows the product named after the page, with that SKU, as a Draft; the owner saves $12.00 and 8 oz, and Commerce says "Product saved" and "Weight saved". When it doesn't, the journey stops here |
| A Draft product stays off the store | While its page is unpublished, the Shop list and the category page don't list the product and its page offers no price or Add to cart |
| The owner uploads a photo and makes it the product's image | The owner uploads a photo to EmDash's Media library, then presses Choose image in the page's Product image & gallery panel (the Dinkus Commerce panel on a Commerce before 0.7.0-beta.2, which has no such panel) and picks that photo, and Commerce says "Image saved" |
| The photo is still the product's image after a reload | After the page's editor is opened afresh, that panel shows the same photo under Product image (Images before 0.7.0-beta.2): the Media library file the owner picked, loaded, with Change image beside it ("No image", another image, or one that doesn't load, fails). Skipped when the photo wasn't chosen |
| Publishing the page puts the product on sale | The owner publishes the page. EmDash's list of product pages shows it as Published, with View published linking to its address; the panel then says On sale; the Shop list shows the product's name, $12.00 and the chosen photo, linked to the page; the page shows them with a ready Add to cart and a link to its category; and the category page lists it, beside "Catalog Caps"'s other products (listing no other product fails). Needs the store's publish check (template-store#152): without it the product stays a Draft and this step fails |
| The product's links open its page | Pressing the product's Shop card, and View details on its category page, opens its page, which answers HTTP 200 headed with the product's name. Skipped when the page wasn't published |
| A new price shows on the store | After the owner saves $13.50 in the panel, the Shop list, the product page and the category page all show it |
| A new name shows on the store | After the owner renames the product in the panel, the Shop list, the product page's heading and the category card all show the new name |
| Archiving the product takes it off the store | After the owner archives it in the panel, the Shop list and the category page stop listing it, and its page answers HTTP 404 saying the product is no longer available |
| Restoring the product and publishing its page again puts it back on the store | The owner presses Restore and the panel shows the product as a Draft, as Commerce restores it; the owner unpublishes and publishes the page again, the panel says On sale, and the Shop list, its page and its category page show it again with its new name and price. Skipped when it wasn't archived |
| The test takes what it added off the store | The test archives the product in its page's panel, whatever state the panel shows for it then, and moves its page (and a category of its own, when it made one) to EmDash's Trash; within a minute the store lists none of them and their addresses stop answering HTTP 200. "Catalog Caps" stays, no longer listing the product. Runs whenever the journey added anything, or pressed Add price and stock |

### Full catalog

Its first two steps stop the journey when they fail, since products need
Content > Products and their pages need a category; every later step is soft, so
one run lists everything the store gets wrong with a full catalog. A big catalog
means many photos and admin calls, so this journey paces itself the most (see the
store's request limit under [Requests stay within the selected sites](#requests-stay-within-the-selected-sites)).

| Step | What it proves |
| --- | --- |
| Content > Products opens and lists every product page | Content > Products opens in the store admin, and the run reads every product page EmDash has (a hundred at a time, as the admin's list does), with whether each is published and the Commerce product it names |
| The catalog's categories are published | Each of the catalog's categories is a published category in EmDash, with a page on the store. The owner adds and publishes any that are missing, and publishes one an earlier run saved but didn't publish; two unpublished categories by one title stop the journey, since the test can't tell which to publish, and so does a list that doesn't answer the test's search, rather than having a category added twice. On a store running Commerce before 0.6.0-beta.1 a missing category stops the journey with nothing added |
| The owner adds what the catalog lacks | Every catalog product the store doesn't show whole gets what it lacks as an owner gives it, on its product page: a page in its category when it has none (put in the category when it isn't), its Commerce product from the page's Dinkus Commerce panel (the product with its SKU that has no page yet, else a new one from Add price and stock, or the one the page already names), restored when archived, its price and weight saved where the panel shows them different, its own photo uploaded and chosen when the page's photo panel (Product image & gallery, or the Dinkus Commerce panel before Commerce 0.7.0-beta.2) shows none, and the page published, or published again when its product is a Draft or the test just completed its style or category. Products without a page get their photos uploaded together first; when they don't all go up, that's reported and each of those products gets its photo uploaded as it's added. A product the test can't complete is reported with what was done for it first, and one whose title Content > Products has more than once is reported and left alone, since the test can't tell which page is the catalog's. A product whose panel had nothing to change, which the store shows wrong anyway, is named as such and left to the next steps. It decides only from what the store shows, so when the Shop list or a category page won't open, or the Shop list shows no products without saying it has none, it adds nothing and fails. Each product it adds gives the journey two more minutes before it times out. Passes with nothing to do once the store has the whole catalog. On a store running Commerce before 0.6.0-beta.1 it adds nothing and fails. A product it adds goes on sale only through the store's publish check (template-store#152) |
| The Shop list shows every catalog product with its own price and photo | The homepage's Shop list shows each catalog product once, at its own price, with its own photo, loaded (the store's placeholder, "No image", or one photo shown for two products fails), linked to its page |
| Each category page lists its products with their own price and photo | Each category's page lists its own products the same way, each linked to the page its Shop card links to, and none of the other categories' |
| Every catalog product's page opens with its name, price and Add to cart | The shopper opens every catalog product's page from its Shop link, one at a time and at the shopper's pace. Each answers HTTP 200, is headed with the product's name, shows its price, and has an Add to cart button wired to the cart that a shopper can press (the test never presses it). When the Shop list couldn't be read or showed none of the catalog's products, it fails with that one reason |
| The owner saves a product's weight with the whole catalog in place | With every product page read again and each catalog product's page there, the owner opens "Catalog Tee 01"'s page (only when exactly one page has that title, and only when its panel shows the SKU CATALOG-TEE-01) and saves its weight in the panel, and Commerce keeps it. A page saved before Commerce kept its own list of product pages opens on "Not a product yet"; the owner presses Add price and stock, which opens the product the page names and makes none. On Commerce 0.3.0-beta.3 this failed once a store had more than about six products |

### Mark as completed

The steps that place an order or make the agent's key stop the journey when
they fail, since nothing after them can run; every other step is soft. Whenever
the key was made, the last step deletes it.

| Step | What it proves |
| --- | --- |
| The owner can open Commerce Orders | Commerce Orders opens in the store admin. When it doesn't, the journey stops here |
| A shopper places a Stripe TEST order for the owner to complete | As in Buy and ship, a shopper pays for a physical product with the test card and Commerce records the payment. Skipped when `DINKUS_E2E_ORDERS_TO_COMPLETE` names an order |
| The owner marks the order completed with a carrier and tracking number | The owner opens the order in Commerce Orders, presses Complete order and types USPS and a tracking number made for the run; Commerce says "Order completed" and shows the order Completed with both. Only a Processing TEST order is completed; any other fails the step and is left alone |
| Commerce Orders keeps the owner's order Completed | Opened again from the list, the order is listed Completed and still shows its carrier and tracking number |
| The test makes a one-hour key for the agent | EmDash makes an admin key named "Live test agent <date and time>" for the signed-in owner, set to stop working after an hour. If EmDash makes a key but sends none the test can use, the test deletes it straight away and the journey stops |
| A shopper places a second Stripe TEST order for the agent to complete | As above, for the agent's order. Skipped when `DINKUS_E2E_ORDERS_TO_COMPLETE` names a second order |
| An agent marks the order completed through Commerce's orders API, sending no carrier or tracking number | With only the key, the agent reads the order and completes it at the version it read; Commerce answers "saved" with the order completed, its version raised and no carrier or tracking number. Only a processing TEST order is completed |
| Commerce Orders shows the agent's order Completed | In the store admin the agent's order is listed Completed, and its page shows "Not recorded" for the carrier and the tracking number |
| The test deletes the agent's key | EmDash deletes the key, and a call with it then gets HTTP 401. Runs whenever the key was made |

### An agent manages a product

The steps that make the agent's key and its product stop the journey when they
fail; every other step is soft. Whenever the key was made, the last step
deletes it.

| Step | What it proves |
| --- | --- |
| The owner opens Content > Products | The saved profile is signed in to the store admin, which the key needs |
| The test makes a one-hour key for the agent | As in Mark as completed |
| An agent makes a Draft product and its page through the store's APIs | With only the key, the agent reads which fields a product page requires and finds Full catalog's published "Catalog Tees" among EmDash's categories, has Commerce make a Draft product (`create`), saves an unpublished page carrying the product in its Commerce product field and filed in "Catalog Tees" (EmDash's `references`), links the two (`link`), and saves $12.00 in stock (`prices`) and 8 oz (`weight`). Commerce then shows the product with the run's name and SKU, still a Draft. A store without "Catalog Tees" gets the page in no category, and the run notes it |
| A Draft product stays off the store | The Shop list and the category page don't offer it and its page doesn't sell it while the page is unpublished |
| Publishing the page through EmDash's API puts the product on sale | The agent publishes the page; within 30 seconds Commerce has the product on sale, the Shop list and its page show it at $12.00 with Add to cart, and "Catalog Tees" lists it beside its other products (listing no other product fails) |
| A price the agent changes from a preview shows on the store | The agent reads the product, sends $13.50 with that read's preview code (`expected`, the first 12 hex digits of SHA-256 over Commerce's `get` answer), Commerce saves it, and the store shows $13.50 |
| Commerce refuses a change made from an old preview | Sent with the code from before the price change, a change to $9.99 is refused with "The product changed since that preview", and the product reads exactly as before |
| Archiving the product through the API takes it off the store | The agent archives it at a fresh preview; the Shop list and the category page drop it and its page says it's no longer available, with HTTP 404 |
| The test takes its product and page off the store | The product is archived and the page is in EmDash's Trash, and the store shows neither. Runs whenever the agent made either |
| The test deletes the agent's key | As in Mark as completed |

### Problems

The steps that open Commerce Orders, open the checkout, pay and wait for the
order stop the journey when they fail, since nothing after them can run; every other step is soft, so
one run reports every card's message. A captcha on Stripe stops the journey at
once, unpaid, since nobody answers it for the test.

| Step | What it proves |
| --- | --- |
| The owner can open Commerce Orders | Commerce Orders opens in the store admin, and the test notes the newest TEST order, so it can tell later that the refused cards made no order |
| A shopper opens Stripe Checkout for one product | As in Buy and ship, a shopper puts a physical product in the cart, gives a US delivery address (on the cart, or on the store's checkout page once the cart only links there, as from Template Store #127) and reaches Stripe's hosted Checkout in test mode; a session that isn't in test mode stops the journey here, before any card. A checkout an earlier run left open is reopened instead of starting another |
| A declined card is turned down with a clear message and no order | Stripe answers 4000 0000 0000 0002 with "Your card has been declined.", and Commerce still reports the checkout waiting for payment, with no order |
| A card without enough funds is turned down with a clear message and no order | The same for 4000 0000 0000 9995 and "Your card has insufficient funds." |
| A card that fails the bank's security check is turned down with a clear message and no order | 4000 0027 6000 3184 brings up Stripe's test bank check; the test presses Fail (again if the test page ignored a press), Stripe says it can't authenticate the payment method, and Commerce still waits for payment |
| The shopper leaves Stripe by its back link and lands back in the store | Stripe's link back to the store opens the store's cart, or from payments#79 the store's checkout page, and that page holds the shopper's cart; a store without the page Payments names fails here |
| The store offers a way back to the same Stripe checkout | On that page, after "Check checkout status", the "Return to secure checkout" link goes to the same Stripe checkout, and the checkout button stays locked, so the shopper can't start a second one |
| The shopper goes back to Stripe, pays once with the 4242 test card and closes the tab | The shopper follows that link (or, when the store offers none, the test opens the checkout's own Stripe page), pays once, and the browser never reaches the store again: Stripe's redirect is stopped and the tab goes blank |
| Commerce makes the order on its own after the shopper closed the tab | With nobody on the store, a new TEST order appears in Commerce Orders within `DINKUS_E2E_COMPLETE_WAIT_SECONDS` (Commerce Orders lists orders but never settles a payment); only then does the test ask Commerce for the checkout's status, which says paid and names the order (commerce#197 case C) |
| The thank-you page confirms the order and empties the cart | Skipped here, since the shopper closed the tab; Buy and ship checks it |
| Commerce Orders lists one new order for the checkout, Processing | The order is listed Processing, and it is the only TEST order newer than the one noted at the start |
| The owner marks the order completed, so the run leaves no order open | As in Mark as completed, with no carrier or tracking number, since nothing was sent. Only a Processing TEST order is completed |

If Stripe takes a payment from a card it should turn down, that card's step
fails, the other cards and both cart steps are skipped, and "Commerce records the
payment Stripe took" checks that order in place of paying again.

### Buy a label in the store admin

The steps that open the Shipping page, place and list the order, see prices,
buy the label, wait for Commerce to complete the order and cancel the label stop
the journey when they fail, since what follows needs them; the other steps are
soft. The Ship plugin draws the Shipping page from hosted Ship's answer on every
press, so the journey tests the plugin and hosted Ship together. Since it may wait
up to `DINKUS_E2E_COMPLETE_WAIT_SECONDS` twice, it gets twice that on top of the
30 minutes every journey has.

| Step | What it proves |
| --- | --- |
| The Shipping page lists Ship's orders in the store admin | The store admin's menu has one Shipping page (or `DINKUS_E2E_SHIPPING_ADMIN`), and it opens on Ship's list of orders, the only page with a Refresh button, rather than on why it can't use Ship: no pass from DinkusKit.com, Ship out of reach, settings to fix, or a sign-in that isn't an Editor or Administrator. The proof notes the Ship plugin and its version. When it doesn't, the journey stops here |
| A shopper places a Stripe TEST order | As in Buy and ship, a shopper pays for a physical product with the test card and Commerce records the payment |
| Commerce Orders lists the order as Processing | Commerce Orders lists the order, TEST and Processing; opening it also sends Ship the paid orders it doesn't have yet |
| The Shipping page lists the order with no label | The Shipping list shows "#N (TEST)" with "No label" (opening the Shipping page again every 15 seconds, for up to `DINKUS_E2E_COMPLETE_WAIT_SECONDS`), and Open shows the order's page |
| The order's page offers a free sandbox label for the package's weight | The order's page says it's a TEST order, shows Ship to, Items, the items' weight and "No label", offers a free Pitney Bowes sandbox label as the label kind, and fills in the weight as the items' weight plus the chosen box's empty weight. When hosted Ship isn't on Pitney Bowes's sandbox, it offers a practice label instead and this step fails |
| See prices quotes USPS services for the package | The browser accepts the filled-in weight, See prices fills the Service list with Ship's prices, and one is for the service `DINKUS_E2E_SERVICE` names (Ground Advantage unless set). Before ship#45 the browser took only weights ending in .1 (1.1, 2.1 and so on), so with a weight such as 4 oz See prices did nothing |
| Buy label buys the sandbox label at the quoted price | Buy label says "Label bought, $X.XX sandbox. Tracking ..." at the quoted price, and the order's page shows the label's service, its tracking number marked "test, not trackable", its postage as "sandbox price, nothing charged" and Status "Label bought" |
| Print label opens the label's PDF from Ship | Print label opens Ship's print link in a new tab, and the link answers with the label's PDF, waiting up to two minutes while Ship fetches it from Pitney Bowes. Its first page draws as a picture of the label, shown in the browser for the step's screenshot |
| Opening Commerce Orders collects the label and completes the order | Commerce Orders shows the order Completed with carrier USPS and the label's tracking number, opened every 30 seconds for up to `DINKUS_E2E_COMPLETE_WAIT_SECONDS` |
| Print label still opens the same PDF once the order is Completed | With the order Completed, the Shipping list still shows "Label bought", the order's page still shows the label, and Print label opens the same PDF as before (the same SHA-256). Before ship#45 the Shipping page lost the label once Commerce completed the order, so it couldn't be printed or cancelled |
| Cancel label voids the sandbox label and the order stays Completed | Cancel label first asks, saying the sandbox label is voided with Pitney Bowes and the order stays as it is in Commerce. After the confirm the page says exactly "Label cancelled.", promising no refund for postage nobody paid, shows no live label and Status "Label cancelled", says the order is Completed in Commerce, and lists the label under Earlier labels as cancelled |
| Shipping lists the order as Label cancelled and Commerce keeps it Completed | The Shipping list shows "Label cancelled", and Commerce Orders still shows the order Completed with the label's carrier and tracking number |

### Free shipping over an amount

The first step stops the journey when it fails, since without the store's
charge there is nothing to check; every other step is soft, so one run checks
both orders.

| Step | What it proves |
| --- | --- |
| DinkusKit.com shows the store's flat charge and free-shipping amount | Signed in as the owner, Your Stores shows this store's checkout settings on a flat amount above $0.00 with a free-shipping amount. The journey reads them and presses nothing; otherwise it stops here and says what to set |
| One item under the amount pays the flat shipping on Stripe | A shopper buys one of the product, whose price is under the amount, with the test card. Before paying, Stripe's page asks for the price plus the flat charge (the amount under "Pay" and its Total due, never just a matching item line), with a Shipping line of the flat charge, and Commerce records the payment |
| Its thank-you page shows the flat shipping | The thank-you page's Shipping row shows the flat charge, its shipping method names it ("Flat rate ($5.00)"), and its Total is the price plus the charge |
| Commerce Orders records the flat shipping | Commerce's checkout status gives the goods, shipping "flat" at the flat charge, and the total, and the order's page in Commerce Orders records the same Shipping and Order total |
| Enough items to reach the amount pay no shipping on Stripe | The shopper buys the fewest of the same product that reach the amount, typed into the cart's quantity box. Stripe asks for the goods alone, under "Pay" and as its Total due, with no Shipping line. Skipped when the first order showed no price |
| Its thank-you page says Free shipping | The Shipping row reads "Free", the shipping method "Free shipping", and the Total is the goods alone |
| Commerce Orders records free shipping | Commerce's checkout status gives shipping "free" at $0.00, and the order's page records Shipping USD 0.00 and the goods as its Order total. A Commerce before 0.7.0 charges the flat amount here and fails this step |
| The owner marks both orders completed, so the run leaves no order open | As in Mark as completed, with no carrier or tracking number. Only Processing TEST orders are completed, including a checkout an earlier run left open that the test had to pay first |

## Proof

A journey's verdict is PASS only when every step passed or was skipped for a
stated reason; an error between steps (a page that won't open) or before the
first one (a saved profile another Chrome holds) fails it too. The run's verdict
is PASS only when every journey passed and the run wasn't interrupted, and
`npx playwright test` exits non-zero otherwise. The run prints each journey's
verdict, then `Verdict:` and the path to `PROOF.md`.

Each run writes `~/.dinkus-e2e/proof/<run>/`: `PROOF.md` and `report.json` (each
journey's verdict, the result and detail of every step, the order, tracking
number and PDF hash, and the plugins and versions the store ran, read from its
admin), a screenshot per step, `label.pdf` and its rendered first-page picture
`label.pdf.png`. Buy a label in the store admin saves its label as
`store-admin-label.pdf` with its picture, and the copy it printed once the order
was Completed as `store-admin-label-completed.pdf`. With `DINKUS_E2E_VIDEO=1` it also keeps a `.webm` video of each
browser window under `video/`. The saved profile's window stays open for the
whole run, so for one video per journey, run the journeys one at a time
(`npm run journey -- cart`). The test hides the code it types
into Cloudflare Access's sign-in, so neither screenshots nor videos show it,
and wipes it from the page when that sign-in fails. The run keeps no Playwright
trace, even for a failed journey: a trace holds every request's headers, the
sign-in cookies for the store's Cloudflare Access and DinkusKit.com among them.
For the same reason a failed step's error reaches the proof, the console and
Playwright's report as its first line alone. Below that line Playwright lists a
request's headers, the addresses a page went to, the elements a locator matched
and the values an assertion saw, and an assertion adds a snapshot of the page,
its links and what its fields hold; none of that is kept, and Playwright's notes
on a failure (`error-context.md`) take no snapshot of the page either. Each
address on that first line loses its query, where a sign-in link, a connect
address or Ship's sign-in code carries its secret, and a Ship print link loses
its token.

On Linux, label rendering requires Poppler's `pdftoppm`; macOS uses Quick Look.
A missing renderer, failed render or invalid picture fails the label-PDF step
rather than silently omitting visual proof. The run records image dimensions
and SHA-256; inspect the picture to verify the label is legible.
