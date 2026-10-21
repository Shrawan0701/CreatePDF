// ISO 3166-1 regions plus Kosovo; labels come from bundled browser locale data.
const regionCodes = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
const regions = new Intl.DisplayNames(['en'], { type: 'region' });
export const INVOICE_COUNTRIES = [...regionCodes, 'XK'].map(code => ({ code, name: regions.of(code) || code })).sort((a, b) => a.name.localeCompare(b.name));
export const countryName = code => INVOICE_COUNTRIES.find(country => country.code === code)?.name || code || '';
export const INVOICE_CURRENCIES = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : ['AED', 'AUD', 'BDT', 'BHD', 'BRL', 'CAD', 'CHF', 'CNY', 'EUR', 'GBP', 'HKD', 'IDR', 'INR', 'JPY', 'KRW', 'KWD', 'LKR', 'MXN', 'MYR', 'NGN', 'NOK', 'NPR', 'NZD', 'OMR', 'PHP', 'PKR', 'QAR', 'SAR', 'SEK', 'SGD', 'THB', 'USD', 'VND', 'ZAR'];
const currencyGroups = {
  EUR: 'AD AT AX BE BL CY DE EE ES FI FR GF GP GR HR IE IT LT LU LV MC ME MF MQ MT NL PM PT RE SI SK SM TF VA YT',
  USD: 'AS BQ EC FM GU IO MH MP PR PW SV TC TL UM US VG VI',
  AUD: 'AU CC CX HM KI NF NR TV', NZD: 'CK NU NZ PN TK', GBP: 'GB GG IM JE', XAF: 'CF CG CM GA GQ TD', XOF: 'BF BJ CI GW ML NE SN TG', XCD: 'AG AI DM GD KN LC MS VC',
};
const currencyByCountry = {
  CW: 'XCG', EH: 'MAD', GS: 'GBP', NC: 'XPF', PS: 'ILS', XK: 'EUR',
  AE: 'AED', AF: 'AFN', AL: 'ALL', AM: 'AMD', AO: 'AOA', AR: 'ARS', AW: 'AWG', AZ: 'AZN', BA: 'BAM', BB: 'BBD', BD: 'BDT', BG: 'EUR', BH: 'BHD', BI: 'BIF', BM: 'BMD', BN: 'BND', BO: 'BOB', BR: 'BRL', BS: 'BSD', BT: 'BTN', BW: 'BWP', BY: 'BYN', BZ: 'BZD', CA: 'CAD', CD: 'CDF', CH: 'CHF', CL: 'CLP', CN: 'CNY', CO: 'COP', CR: 'CRC', CU: 'CUP', CV: 'CVE', CZ: 'CZK', DJ: 'DJF', DK: 'DKK', DO: 'DOP', DZ: 'DZD', EG: 'EGP', ER: 'ERN', ET: 'ETB', FJ: 'FJD', FK: 'FKP', FO: 'DKK', GB: 'GBP', GE: 'GEL', GH: 'GHS', GI: 'GIP', GL: 'DKK', GM: 'GMD', GN: 'GNF', GT: 'GTQ', GY: 'GYD', HK: 'HKD', HN: 'HNL', HT: 'HTG', HU: 'HUF', ID: 'IDR', IL: 'ILS', IN: 'INR', IQ: 'IQD', IR: 'IRR', IS: 'ISK', JM: 'JMD', JO: 'JOD', JP: 'JPY', KE: 'KES', KG: 'KGS', KH: 'KHR', KM: 'KMF', KP: 'KPW', KR: 'KRW', KW: 'KWD', KY: 'KYD', KZ: 'KZT', LA: 'LAK', LB: 'LBP', LI: 'CHF', LK: 'LKR', LR: 'LRD', LS: 'LSL', LY: 'LYD', MA: 'MAD', MD: 'MDL', MG: 'MGA', MK: 'MKD', MM: 'MMK', MN: 'MNT', MO: 'MOP', MR: 'MRU', MU: 'MUR', MV: 'MVR', MW: 'MWK', MX: 'MXN', MY: 'MYR', MZ: 'MZN', NA: 'NAD', NG: 'NGN', NI: 'NIO', NO: 'NOK', NP: 'NPR', OM: 'OMR', PA: 'PAB', PE: 'PEN', PF: 'XPF', PG: 'PGK', PH: 'PHP', PK: 'PKR', PL: 'PLN', PY: 'PYG', QA: 'QAR', RO: 'RON', RS: 'RSD', RU: 'RUB', RW: 'RWF', SA: 'SAR', SB: 'SBD', SC: 'SCR', SD: 'SDG', SE: 'SEK', SG: 'SGD', SH: 'SHP', SO: 'SOS', SR: 'SRD', SS: 'SSP', ST: 'STN', SX: 'XCG', SY: 'SYP', SZ: 'SZL', TH: 'THB', TJ: 'TJS', TM: 'TMT', TN: 'TND', TO: 'TOP', TR: 'TRY', TT: 'TTD', TW: 'TWD', TZ: 'TZS', UA: 'UAH', UG: 'UGX', UY: 'UYU', UZ: 'UZS', VE: 'VES', VN: 'VND', VU: 'VUV', WF: 'XPF', WS: 'WST', YE: 'YER', ZA: 'ZAR', ZM: 'ZMW', ZW: 'ZWG',
};
export function countryCurrency(country) {
  const grouped = Object.entries(currencyGroups).find(([, members]) => members.split(' ').includes(country))?.[0];
  const currency = currencyByCountry[country] || grouped || 'USD';
  return INVOICE_CURRENCIES.includes(currency) ? currency : 'USD';
}
const vatRegions = new Set('AD AE AL AM AR AT AZ BA BD BE BF BG BH BI BJ BO BR BW BY CD CH CI CL CM CN CO CR CV CY CZ DE DK DO DZ EC EE EG ES ET FI FR GA GB GE GH GN GR GT GW HN HR HT HU ID IE IL IS IT JO KE KG KH KR KZ LA LB LI LS LT LU LV MA MD ME MG MK ML MN MR MT MU MW MX MZ NA NE NG NI NL NO NP OM PE PH PK PL PS PT PY RO RS RU RW SA SE SI SK SN ST SV TD TG TH TJ TN TR TW TZ UA UG UY UZ VE VN ZA ZM'.split(' '));
export function countryTax(country) {
  if (country === 'IN') return { name: 'GST', idLabel: 'GSTIN' };
  if (country === 'AU') return { name: 'GST', idLabel: 'ABN' };
  if (country === 'NZ') return { name: 'GST', idLabel: 'GST number' };
  if (country === 'SG') return { name: 'GST', idLabel: 'GST registration / UEN' };
  if (country === 'CA') return { name: 'GST/HST', idLabel: 'GST/HST number' };
  if (country === 'US') return { name: 'Sales tax', idLabel: 'Tax ID' };
  if (vatRegions.has(country)) return { name: 'VAT', idLabel: 'VAT / tax number' };
  return { name: 'Tax', idLabel: 'Tax ID' };
}
const precision = new Map();
export function currencyDigits(currency = 'USD') {
  if (!precision.has(currency)) precision.set(currency, new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits);
  return precision.get(currency);
}
export const currencyFactor = currency => 10 ** currencyDigits(currency);
export const invoiceLocale = invoice => invoice.seller.country === 'IN' ? 'en-IN' : 'en-US';
export const formatMinor = (minor, currency = 'USD', locale = 'en-US') => new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / currencyFactor(currency));
