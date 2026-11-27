// Copy shared across pages. Plain strings, no HTML.
import type { DrugKey } from './data';

export const SHARED_FAQS: [string, string][] = [
  ['Do I need a prescription?', 'Yes. Mounjaro and Wegovy are prescription-only in the UK. Every provider listed supplies them only after a consultation with a registered prescriber, who decides whether the medicine is suitable for you.'],
  ['Is the price shown the full cost?', "It's the price the provider publishes for that dose. Some include the consultation and delivery and some don't, so check the total at the provider's checkout before you pay."],
  ['How often are prices checked?', "Every day. We read each provider's own price page automatically and show how long ago that was. If we haven't confirmed a price in the last 48 hours, we take it off the page rather than show an old number."],
  ['What does the Subscription tag mean?', "That provider only sells at that price as part of an ongoing plan or membership, so you're agreeing to recurring payments. Tick “Hide subscription-only” to leave them out."],
  ['Do providers pay to be listed?', "No. Nobody pays to appear here, links aren't affiliate links, and the order is set by price alone."],
];

export const DRUG_FAQS: Record<DrugKey, [string, string][]> = {
  mounjaro: [
    ['Why does Mounjaro cost more at higher doses?', 'Each pen strength is priced separately and higher strengths cost more. Most people step up from 2.5 mg over several months, so the price you pay long term is the price of the dose you stay on, not the starting one.'],
    ['What is the first-year cost?', 'The total of 12 pens on a common step-up plan: one month each at 2.5, 5, 7.5, 10 and 12.5 mg, then 15 mg for the rest of the year. Your prescriber may keep you on a lower dose, which would cost less.'],
  ],
  wegovy: [
    ['What is the difference between Wegovy and the Wegovy pill?', 'Both contain semaglutide. Wegovy is a weekly injection and the Wegovy pill is a daily tablet. Doses and prices differ, so they have separate price lists.'],
    ['What is the first-year cost?', 'The total of 12 pens on a common step-up plan: one month each at 0.25, 0.5, 1 and 1.7 mg, then 2.4 mg for the rest of the year.'],
  ],
  'wegovy-pill': [
    ['Is the Wegovy pill cheaper than the injection?', 'It depends on the provider and the dose. Compare the dose you expect to stay on, not the starting dose.'],
    ['What is the first-year cost?', 'The total of 12 packs of 30 tablets on a common step-up plan: one month each at 1.5, 4 and 9 mg, then 25 mg for the rest of the year.'],
  ],
};

export const METHOD: [string, string][] = [
  ["We read each provider's own page", 'An automated job opens the product page on each provider’s website every morning and reads the published price for every dose.'],
  ['We prefer the data behind the page', 'Where a site publishes structured product data, such as its shop’s price feed, we read that instead of the visible text. It’s more accurate and doesn’t break when the design changes.'],
  ['We check the numbers make sense', 'Prices must sit in a realistic range and rise with the dose. A price that changes by more than a third overnight is held back until we see it again the next day.'],
  ['We remove anything we can’t confirm', 'Every price shows when we last confirmed it. If a provider’s page can’t be read for 48 hours, its prices come off the site until the next clean read.'],
];
