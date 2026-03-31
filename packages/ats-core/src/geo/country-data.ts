import type { CountryRecord } from "./types";

/**
 * Forward map: ISO 3166-1 alpha-2 code -> CountryRecord.
 * Complete list of ~250 countries and territories.
 */
export const COUNTRIES: ReadonlyMap<string, CountryRecord> = new Map<
  string,
  CountryRecord
>([
  // A
  ["AD", { alpha2: "AD", alpha3: "AND", name: "andorra", aliases: [], primaryTimezone: "Europe/Andorra" }],
  ["AE", { alpha2: "AE", alpha3: "ARE", name: "united arab emirates", aliases: ["uae", "emirates"], primaryTimezone: "Asia/Dubai" }],
  ["AF", { alpha2: "AF", alpha3: "AFG", name: "afghanistan", aliases: [], primaryTimezone: "Asia/Kabul" }],
  ["AG", { alpha2: "AG", alpha3: "ATG", name: "antigua and barbuda", aliases: ["antigua"], primaryTimezone: "America/Antigua" }],
  ["AI", { alpha2: "AI", alpha3: "AIA", name: "anguilla", aliases: [], primaryTimezone: "America/Anguilla" }],
  ["AL", { alpha2: "AL", alpha3: "ALB", name: "albania", aliases: [], primaryTimezone: "Europe/Tirane" }],
  ["AM", { alpha2: "AM", alpha3: "ARM", name: "armenia", aliases: [], primaryTimezone: "Asia/Yerevan" }],
  ["AO", { alpha2: "AO", alpha3: "AGO", name: "angola", aliases: [], primaryTimezone: "Africa/Luanda" }],
  ["AQ", { alpha2: "AQ", alpha3: "ATA", name: "antarctica", aliases: [], primaryTimezone: "Antarctica/Palmer" }],
  ["AR", { alpha2: "AR", alpha3: "ARG", name: "argentina", aliases: [], primaryTimezone: "America/Argentina/Buenos_Aires" }],
  ["AS", { alpha2: "AS", alpha3: "ASM", name: "american samoa", aliases: [], primaryTimezone: "Pacific/Pago_Pago" }],
  ["AT", { alpha2: "AT", alpha3: "AUT", name: "austria", aliases: [], primaryTimezone: "Europe/Vienna" }],
  ["AU", { alpha2: "AU", alpha3: "AUS", name: "australia", aliases: ["oz"], primaryTimezone: "Australia/Sydney" }],
  ["AW", { alpha2: "AW", alpha3: "ABW", name: "aruba", aliases: [], primaryTimezone: "America/Aruba" }],
  ["AX", { alpha2: "AX", alpha3: "ALA", name: "aland islands", aliases: [], primaryTimezone: "Europe/Mariehamn" }],
  ["AZ", { alpha2: "AZ", alpha3: "AZE", name: "azerbaijan", aliases: [], primaryTimezone: "Asia/Baku" }],

  // B
  ["BA", { alpha2: "BA", alpha3: "BIH", name: "bosnia and herzegovina", aliases: ["bosnia"], primaryTimezone: "Europe/Sarajevo" }],
  ["BB", { alpha2: "BB", alpha3: "BRB", name: "barbados", aliases: [], primaryTimezone: "America/Barbados" }],
  ["BD", { alpha2: "BD", alpha3: "BGD", name: "bangladesh", aliases: [], primaryTimezone: "Asia/Dhaka" }],
  ["BE", { alpha2: "BE", alpha3: "BEL", name: "belgium", aliases: [], primaryTimezone: "Europe/Brussels" }],
  ["BF", { alpha2: "BF", alpha3: "BFA", name: "burkina faso", aliases: [], primaryTimezone: "Africa/Ouagadougou" }],
  ["BG", { alpha2: "BG", alpha3: "BGR", name: "bulgaria", aliases: [], primaryTimezone: "Europe/Sofia" }],
  ["BH", { alpha2: "BH", alpha3: "BHR", name: "bahrain", aliases: [], primaryTimezone: "Asia/Bahrain" }],
  ["BI", { alpha2: "BI", alpha3: "BDI", name: "burundi", aliases: [], primaryTimezone: "Africa/Bujumbura" }],
  ["BJ", { alpha2: "BJ", alpha3: "BEN", name: "benin", aliases: [], primaryTimezone: "Africa/Porto-Novo" }],
  ["BL", { alpha2: "BL", alpha3: "BLM", name: "saint barthelemy", aliases: ["st barthelemy"], primaryTimezone: "America/St_Barthelemy" }],
  ["BM", { alpha2: "BM", alpha3: "BMU", name: "bermuda", aliases: [], primaryTimezone: "Atlantic/Bermuda" }],
  ["BN", { alpha2: "BN", alpha3: "BRN", name: "brunei", aliases: ["brunei darussalam"], primaryTimezone: "Asia/Brunei" }],
  ["BO", { alpha2: "BO", alpha3: "BOL", name: "bolivia", aliases: [], primaryTimezone: "America/La_Paz" }],
  ["BQ", { alpha2: "BQ", alpha3: "BES", name: "bonaire, sint eustatius and saba", aliases: ["bonaire"], primaryTimezone: "America/Kralendijk" }],
  ["BR", { alpha2: "BR", alpha3: "BRA", name: "brazil", aliases: ["brasil"], primaryTimezone: "America/Sao_Paulo" }],
  ["BS", { alpha2: "BS", alpha3: "BHS", name: "bahamas", aliases: ["the bahamas"], primaryTimezone: "America/Nassau" }],
  ["BT", { alpha2: "BT", alpha3: "BTN", name: "bhutan", aliases: [], primaryTimezone: "Asia/Thimphu" }],
  ["BV", { alpha2: "BV", alpha3: "BVT", name: "bouvet island", aliases: [], primaryTimezone: "UTC" }],
  ["BW", { alpha2: "BW", alpha3: "BWA", name: "botswana", aliases: [], primaryTimezone: "Africa/Gaborone" }],
  ["BY", { alpha2: "BY", alpha3: "BLR", name: "belarus", aliases: [], primaryTimezone: "Europe/Minsk" }],
  ["BZ", { alpha2: "BZ", alpha3: "BLZ", name: "belize", aliases: [], primaryTimezone: "America/Belize" }],

  // C
  ["CA", { alpha2: "CA", alpha3: "CAN", name: "canada", aliases: [], primaryTimezone: "America/Toronto" }],
  ["CC", { alpha2: "CC", alpha3: "CCK", name: "cocos (keeling) islands", aliases: ["cocos islands"], primaryTimezone: "Indian/Cocos" }],
  ["CD", { alpha2: "CD", alpha3: "COD", name: "democratic republic of the congo", aliases: ["drc", "congo-kinshasa"], primaryTimezone: "Africa/Kinshasa" }],
  ["CF", { alpha2: "CF", alpha3: "CAF", name: "central african republic", aliases: [], primaryTimezone: "Africa/Bangui" }],
  ["CG", { alpha2: "CG", alpha3: "COG", name: "republic of the congo", aliases: ["congo", "congo-brazzaville"], primaryTimezone: "Africa/Brazzaville" }],
  ["CH", { alpha2: "CH", alpha3: "CHE", name: "switzerland", aliases: ["swiss"], primaryTimezone: "Europe/Zurich" }],
  ["CI", { alpha2: "CI", alpha3: "CIV", name: "cote d'ivoire", aliases: ["ivory coast"], primaryTimezone: "Africa/Abidjan" }],
  ["CK", { alpha2: "CK", alpha3: "COK", name: "cook islands", aliases: [], primaryTimezone: "Pacific/Rarotonga" }],
  ["CL", { alpha2: "CL", alpha3: "CHL", name: "chile", aliases: [], primaryTimezone: "America/Santiago" }],
  ["CM", { alpha2: "CM", alpha3: "CMR", name: "cameroon", aliases: [], primaryTimezone: "Africa/Douala" }],
  ["CN", { alpha2: "CN", alpha3: "CHN", name: "china", aliases: ["prc", "people's republic of china"], primaryTimezone: "Asia/Shanghai" }],
  ["CO", { alpha2: "CO", alpha3: "COL", name: "colombia", aliases: [], primaryTimezone: "America/Bogota" }],
  ["CR", { alpha2: "CR", alpha3: "CRI", name: "costa rica", aliases: [], primaryTimezone: "America/Costa_Rica" }],
  ["CU", { alpha2: "CU", alpha3: "CUB", name: "cuba", aliases: [], primaryTimezone: "America/Havana" }],
  ["CV", { alpha2: "CV", alpha3: "CPV", name: "cabo verde", aliases: ["cape verde"], primaryTimezone: "Atlantic/Cape_Verde" }],
  ["CW", { alpha2: "CW", alpha3: "CUW", name: "curacao", aliases: [], primaryTimezone: "America/Curacao" }],
  ["CX", { alpha2: "CX", alpha3: "CXR", name: "christmas island", aliases: [], primaryTimezone: "Indian/Christmas" }],
  ["CY", { alpha2: "CY", alpha3: "CYP", name: "cyprus", aliases: [], primaryTimezone: "Asia/Nicosia" }],
  ["CZ", { alpha2: "CZ", alpha3: "CZE", name: "czechia", aliases: ["czech republic"], primaryTimezone: "Europe/Prague" }],

  // D
  ["DE", { alpha2: "DE", alpha3: "DEU", name: "germany", aliases: ["deutschland"], primaryTimezone: "Europe/Berlin" }],
  ["DJ", { alpha2: "DJ", alpha3: "DJI", name: "djibouti", aliases: [], primaryTimezone: "Africa/Djibouti" }],
  ["DK", { alpha2: "DK", alpha3: "DNK", name: "denmark", aliases: [], primaryTimezone: "Europe/Copenhagen" }],
  ["DM", { alpha2: "DM", alpha3: "DMA", name: "dominica", aliases: [], primaryTimezone: "America/Dominica" }],
  ["DO", { alpha2: "DO", alpha3: "DOM", name: "dominican republic", aliases: [], primaryTimezone: "America/Santo_Domingo" }],
  ["DZ", { alpha2: "DZ", alpha3: "DZA", name: "algeria", aliases: [], primaryTimezone: "Africa/Algiers" }],

  // E
  ["EC", { alpha2: "EC", alpha3: "ECU", name: "ecuador", aliases: [], primaryTimezone: "America/Guayaquil" }],
  ["EE", { alpha2: "EE", alpha3: "EST", name: "estonia", aliases: [], primaryTimezone: "Europe/Tallinn" }],
  ["EG", { alpha2: "EG", alpha3: "EGY", name: "egypt", aliases: [], primaryTimezone: "Africa/Cairo" }],
  ["EH", { alpha2: "EH", alpha3: "ESH", name: "western sahara", aliases: [], primaryTimezone: "Africa/El_Aaiun" }],
  ["ER", { alpha2: "ER", alpha3: "ERI", name: "eritrea", aliases: [], primaryTimezone: "Africa/Asmara" }],
  ["ES", { alpha2: "ES", alpha3: "ESP", name: "spain", aliases: [], primaryTimezone: "Europe/Madrid" }],
  ["ET", { alpha2: "ET", alpha3: "ETH", name: "ethiopia", aliases: [], primaryTimezone: "Africa/Addis_Ababa" }],

  // F
  ["FI", { alpha2: "FI", alpha3: "FIN", name: "finland", aliases: [], primaryTimezone: "Europe/Helsinki" }],
  ["FJ", { alpha2: "FJ", alpha3: "FJI", name: "fiji", aliases: [], primaryTimezone: "Pacific/Fiji" }],
  ["FK", { alpha2: "FK", alpha3: "FLK", name: "falkland islands", aliases: ["malvinas"], primaryTimezone: "Atlantic/Stanley" }],
  ["FM", { alpha2: "FM", alpha3: "FSM", name: "micronesia", aliases: ["federated states of micronesia"], primaryTimezone: "Pacific/Pohnpei" }],
  ["FO", { alpha2: "FO", alpha3: "FRO", name: "faroe islands", aliases: [], primaryTimezone: "Atlantic/Faroe" }],
  ["FR", { alpha2: "FR", alpha3: "FRA", name: "france", aliases: [], primaryTimezone: "Europe/Paris" }],

  // G
  ["GA", { alpha2: "GA", alpha3: "GAB", name: "gabon", aliases: [], primaryTimezone: "Africa/Libreville" }],
  ["GB", { alpha2: "GB", alpha3: "GBR", name: "united kingdom", aliases: ["uk", "great britain", "britain", "england", "scotland", "wales", "northern ireland"], primaryTimezone: "Europe/London" }],
  ["GD", { alpha2: "GD", alpha3: "GRD", name: "grenada", aliases: [], primaryTimezone: "America/Grenada" }],
  ["GE", { alpha2: "GE", alpha3: "GEO", name: "georgia", aliases: [], primaryTimezone: "Asia/Tbilisi" }],
  ["GF", { alpha2: "GF", alpha3: "GUF", name: "french guiana", aliases: [], primaryTimezone: "America/Cayenne" }],
  ["GG", { alpha2: "GG", alpha3: "GGY", name: "guernsey", aliases: [], primaryTimezone: "Europe/Guernsey" }],
  ["GH", { alpha2: "GH", alpha3: "GHA", name: "ghana", aliases: [], primaryTimezone: "Africa/Accra" }],
  ["GI", { alpha2: "GI", alpha3: "GIB", name: "gibraltar", aliases: [], primaryTimezone: "Europe/Gibraltar" }],
  ["GL", { alpha2: "GL", alpha3: "GRL", name: "greenland", aliases: [], primaryTimezone: "America/Nuuk" }],
  ["GM", { alpha2: "GM", alpha3: "GMB", name: "gambia", aliases: ["the gambia"], primaryTimezone: "Africa/Banjul" }],
  ["GN", { alpha2: "GN", alpha3: "GIN", name: "guinea", aliases: [], primaryTimezone: "Africa/Conakry" }],
  ["GP", { alpha2: "GP", alpha3: "GLP", name: "guadeloupe", aliases: [], primaryTimezone: "America/Guadeloupe" }],
  ["GQ", { alpha2: "GQ", alpha3: "GNQ", name: "equatorial guinea", aliases: [], primaryTimezone: "Africa/Malabo" }],
  ["GR", { alpha2: "GR", alpha3: "GRC", name: "greece", aliases: [], primaryTimezone: "Europe/Athens" }],
  ["GS", { alpha2: "GS", alpha3: "SGS", name: "south georgia and the south sandwich islands", aliases: [], primaryTimezone: "Atlantic/South_Georgia" }],
  ["GT", { alpha2: "GT", alpha3: "GTM", name: "guatemala", aliases: [], primaryTimezone: "America/Guatemala" }],
  ["GU", { alpha2: "GU", alpha3: "GUM", name: "guam", aliases: [], primaryTimezone: "Pacific/Guam" }],
  ["GW", { alpha2: "GW", alpha3: "GNB", name: "guinea-bissau", aliases: [], primaryTimezone: "Africa/Bissau" }],
  ["GY", { alpha2: "GY", alpha3: "GUY", name: "guyana", aliases: [], primaryTimezone: "America/Guyana" }],

  // H
  ["HK", { alpha2: "HK", alpha3: "HKG", name: "hong kong", aliases: [], primaryTimezone: "Asia/Hong_Kong" }],
  ["HM", { alpha2: "HM", alpha3: "HMD", name: "heard island and mcdonald islands", aliases: [], primaryTimezone: "Indian/Kerguelen" }],
  ["HN", { alpha2: "HN", alpha3: "HND", name: "honduras", aliases: [], primaryTimezone: "America/Tegucigalpa" }],
  ["HR", { alpha2: "HR", alpha3: "HRV", name: "croatia", aliases: [], primaryTimezone: "Europe/Zagreb" }],
  ["HT", { alpha2: "HT", alpha3: "HTI", name: "haiti", aliases: [], primaryTimezone: "America/Port-au-Prince" }],
  ["HU", { alpha2: "HU", alpha3: "HUN", name: "hungary", aliases: [], primaryTimezone: "Europe/Budapest" }],

  // I
  ["ID", { alpha2: "ID", alpha3: "IDN", name: "indonesia", aliases: [], primaryTimezone: "Asia/Jakarta" }],
  ["IE", { alpha2: "IE", alpha3: "IRL", name: "ireland", aliases: ["republic of ireland", "eire"], primaryTimezone: "Europe/Dublin" }],
  ["IL", { alpha2: "IL", alpha3: "ISR", name: "israel", aliases: [], primaryTimezone: "Asia/Jerusalem" }],
  ["IM", { alpha2: "IM", alpha3: "IMN", name: "isle of man", aliases: [], primaryTimezone: "Europe/Isle_of_Man" }],
  ["IN", { alpha2: "IN", alpha3: "IND", name: "india", aliases: [], primaryTimezone: "Asia/Kolkata" }],
  ["IO", { alpha2: "IO", alpha3: "IOT", name: "british indian ocean territory", aliases: [], primaryTimezone: "Indian/Chagos" }],
  ["IQ", { alpha2: "IQ", alpha3: "IRQ", name: "iraq", aliases: [], primaryTimezone: "Asia/Baghdad" }],
  ["IR", { alpha2: "IR", alpha3: "IRN", name: "iran", aliases: ["islamic republic of iran"], primaryTimezone: "Asia/Tehran" }],
  ["IS", { alpha2: "IS", alpha3: "ISL", name: "iceland", aliases: [], primaryTimezone: "Atlantic/Reykjavik" }],
  ["IT", { alpha2: "IT", alpha3: "ITA", name: "italy", aliases: [], primaryTimezone: "Europe/Rome" }],

  // J
  ["JE", { alpha2: "JE", alpha3: "JEY", name: "jersey", aliases: [], primaryTimezone: "Europe/Jersey" }],
  ["JM", { alpha2: "JM", alpha3: "JAM", name: "jamaica", aliases: [], primaryTimezone: "America/Jamaica" }],
  ["JO", { alpha2: "JO", alpha3: "JOR", name: "jordan", aliases: [], primaryTimezone: "Asia/Amman" }],
  ["JP", { alpha2: "JP", alpha3: "JPN", name: "japan", aliases: [], primaryTimezone: "Asia/Tokyo" }],

  // K
  ["KE", { alpha2: "KE", alpha3: "KEN", name: "kenya", aliases: [], primaryTimezone: "Africa/Nairobi" }],
  ["KG", { alpha2: "KG", alpha3: "KGZ", name: "kyrgyzstan", aliases: [], primaryTimezone: "Asia/Bishkek" }],
  ["KH", { alpha2: "KH", alpha3: "KHM", name: "cambodia", aliases: [], primaryTimezone: "Asia/Phnom_Penh" }],
  ["KI", { alpha2: "KI", alpha3: "KIR", name: "kiribati", aliases: [], primaryTimezone: "Pacific/Tarawa" }],
  ["KM", { alpha2: "KM", alpha3: "COM", name: "comoros", aliases: [], primaryTimezone: "Indian/Comoro" }],
  ["KN", { alpha2: "KN", alpha3: "KNA", name: "saint kitts and nevis", aliases: ["st kitts and nevis", "st kitts"], primaryTimezone: "America/St_Kitts" }],
  ["KP", { alpha2: "KP", alpha3: "PRK", name: "north korea", aliases: ["democratic people's republic of korea", "dprk"], primaryTimezone: "Asia/Pyongyang" }],
  ["KR", { alpha2: "KR", alpha3: "KOR", name: "south korea", aliases: ["republic of korea", "korea"], primaryTimezone: "Asia/Seoul" }],
  ["KW", { alpha2: "KW", alpha3: "KWT", name: "kuwait", aliases: [], primaryTimezone: "Asia/Kuwait" }],
  ["KY", { alpha2: "KY", alpha3: "CYM", name: "cayman islands", aliases: [], primaryTimezone: "America/Cayman" }],
  ["KZ", { alpha2: "KZ", alpha3: "KAZ", name: "kazakhstan", aliases: [], primaryTimezone: "Asia/Almaty" }],

  // L
  ["LA", { alpha2: "LA", alpha3: "LAO", name: "laos", aliases: ["lao people's democratic republic"], primaryTimezone: "Asia/Vientiane" }],
  ["LB", { alpha2: "LB", alpha3: "LBN", name: "lebanon", aliases: [], primaryTimezone: "Asia/Beirut" }],
  ["LC", { alpha2: "LC", alpha3: "LCA", name: "saint lucia", aliases: ["st lucia"], primaryTimezone: "America/St_Lucia" }],
  ["LI", { alpha2: "LI", alpha3: "LIE", name: "liechtenstein", aliases: [], primaryTimezone: "Europe/Vaduz" }],
  ["LK", { alpha2: "LK", alpha3: "LKA", name: "sri lanka", aliases: [], primaryTimezone: "Asia/Colombo" }],
  ["LR", { alpha2: "LR", alpha3: "LBR", name: "liberia", aliases: [], primaryTimezone: "Africa/Monrovia" }],
  ["LS", { alpha2: "LS", alpha3: "LSO", name: "lesotho", aliases: [], primaryTimezone: "Africa/Maseru" }],
  ["LT", { alpha2: "LT", alpha3: "LTU", name: "lithuania", aliases: [], primaryTimezone: "Europe/Vilnius" }],
  ["LU", { alpha2: "LU", alpha3: "LUX", name: "luxembourg", aliases: [], primaryTimezone: "Europe/Luxembourg" }],
  ["LV", { alpha2: "LV", alpha3: "LVA", name: "latvia", aliases: [], primaryTimezone: "Europe/Riga" }],
  ["LY", { alpha2: "LY", alpha3: "LBY", name: "libya", aliases: [], primaryTimezone: "Africa/Tripoli" }],

  // M
  ["MA", { alpha2: "MA", alpha3: "MAR", name: "morocco", aliases: [], primaryTimezone: "Africa/Casablanca" }],
  ["MC", { alpha2: "MC", alpha3: "MCO", name: "monaco", aliases: [], primaryTimezone: "Europe/Monaco" }],
  ["MD", { alpha2: "MD", alpha3: "MDA", name: "moldova", aliases: ["republic of moldova"], primaryTimezone: "Europe/Chisinau" }],
  ["ME", { alpha2: "ME", alpha3: "MNE", name: "montenegro", aliases: [], primaryTimezone: "Europe/Podgorica" }],
  ["MF", { alpha2: "MF", alpha3: "MAF", name: "saint martin", aliases: ["st martin"], primaryTimezone: "America/Marigot" }],
  ["MG", { alpha2: "MG", alpha3: "MDG", name: "madagascar", aliases: [], primaryTimezone: "Indian/Antananarivo" }],
  ["MH", { alpha2: "MH", alpha3: "MHL", name: "marshall islands", aliases: [], primaryTimezone: "Pacific/Majuro" }],
  ["MK", { alpha2: "MK", alpha3: "MKD", name: "north macedonia", aliases: ["macedonia"], primaryTimezone: "Europe/Skopje" }],
  ["ML", { alpha2: "ML", alpha3: "MLI", name: "mali", aliases: [], primaryTimezone: "Africa/Bamako" }],
  ["MM", { alpha2: "MM", alpha3: "MMR", name: "myanmar", aliases: ["burma"], primaryTimezone: "Asia/Yangon" }],
  ["MN", { alpha2: "MN", alpha3: "MNG", name: "mongolia", aliases: [], primaryTimezone: "Asia/Ulaanbaatar" }],
  ["MO", { alpha2: "MO", alpha3: "MAC", name: "macao", aliases: ["macau"], primaryTimezone: "Asia/Macau" }],
  ["MP", { alpha2: "MP", alpha3: "MNP", name: "northern mariana islands", aliases: [], primaryTimezone: "Pacific/Guam" }],
  ["MQ", { alpha2: "MQ", alpha3: "MTQ", name: "martinique", aliases: [], primaryTimezone: "America/Martinique" }],
  ["MR", { alpha2: "MR", alpha3: "MRT", name: "mauritania", aliases: [], primaryTimezone: "Africa/Nouakchott" }],
  ["MS", { alpha2: "MS", alpha3: "MSR", name: "montserrat", aliases: [], primaryTimezone: "America/Montserrat" }],
  ["MT", { alpha2: "MT", alpha3: "MLT", name: "malta", aliases: [], primaryTimezone: "Europe/Malta" }],
  ["MU", { alpha2: "MU", alpha3: "MUS", name: "mauritius", aliases: [], primaryTimezone: "Indian/Mauritius" }],
  ["MV", { alpha2: "MV", alpha3: "MDV", name: "maldives", aliases: [], primaryTimezone: "Indian/Maldives" }],
  ["MW", { alpha2: "MW", alpha3: "MWI", name: "malawi", aliases: [], primaryTimezone: "Africa/Blantyre" }],
  ["MX", { alpha2: "MX", alpha3: "MEX", name: "mexico", aliases: [], primaryTimezone: "America/Mexico_City" }],
  ["MY", { alpha2: "MY", alpha3: "MYS", name: "malaysia", aliases: [], primaryTimezone: "Asia/Kuala_Lumpur" }],
  ["MZ", { alpha2: "MZ", alpha3: "MOZ", name: "mozambique", aliases: [], primaryTimezone: "Africa/Maputo" }],

  // N
  ["NA", { alpha2: "NA", alpha3: "NAM", name: "namibia", aliases: [], primaryTimezone: "Africa/Windhoek" }],
  ["NC", { alpha2: "NC", alpha3: "NCL", name: "new caledonia", aliases: [], primaryTimezone: "Pacific/Noumea" }],
  ["NE", { alpha2: "NE", alpha3: "NER", name: "niger", aliases: [], primaryTimezone: "Africa/Niamey" }],
  ["NF", { alpha2: "NF", alpha3: "NFK", name: "norfolk island", aliases: [], primaryTimezone: "Pacific/Norfolk" }],
  ["NG", { alpha2: "NG", alpha3: "NGA", name: "nigeria", aliases: [], primaryTimezone: "Africa/Lagos" }],
  ["NI", { alpha2: "NI", alpha3: "NIC", name: "nicaragua", aliases: [], primaryTimezone: "America/Managua" }],
  ["NL", { alpha2: "NL", alpha3: "NLD", name: "netherlands", aliases: ["holland", "the netherlands"], primaryTimezone: "Europe/Amsterdam" }],
  ["NO", { alpha2: "NO", alpha3: "NOR", name: "norway", aliases: [], primaryTimezone: "Europe/Oslo" }],
  ["NP", { alpha2: "NP", alpha3: "NPL", name: "nepal", aliases: [], primaryTimezone: "Asia/Kathmandu" }],
  ["NR", { alpha2: "NR", alpha3: "NRU", name: "nauru", aliases: [], primaryTimezone: "Pacific/Nauru" }],
  ["NU", { alpha2: "NU", alpha3: "NIU", name: "niue", aliases: [], primaryTimezone: "Pacific/Niue" }],
  ["NZ", { alpha2: "NZ", alpha3: "NZL", name: "new zealand", aliases: [], primaryTimezone: "Pacific/Auckland" }],

  // O
  ["OM", { alpha2: "OM", alpha3: "OMN", name: "oman", aliases: [], primaryTimezone: "Asia/Muscat" }],

  // P
  ["PA", { alpha2: "PA", alpha3: "PAN", name: "panama", aliases: [], primaryTimezone: "America/Panama" }],
  ["PE", { alpha2: "PE", alpha3: "PER", name: "peru", aliases: [], primaryTimezone: "America/Lima" }],
  ["PF", { alpha2: "PF", alpha3: "PYF", name: "french polynesia", aliases: [], primaryTimezone: "Pacific/Tahiti" }],
  ["PG", { alpha2: "PG", alpha3: "PNG", name: "papua new guinea", aliases: [], primaryTimezone: "Pacific/Port_Moresby" }],
  ["PH", { alpha2: "PH", alpha3: "PHL", name: "philippines", aliases: [], primaryTimezone: "Asia/Manila" }],
  ["PK", { alpha2: "PK", alpha3: "PAK", name: "pakistan", aliases: [], primaryTimezone: "Asia/Karachi" }],
  ["PL", { alpha2: "PL", alpha3: "POL", name: "poland", aliases: [], primaryTimezone: "Europe/Warsaw" }],
  ["PM", { alpha2: "PM", alpha3: "SPM", name: "saint pierre and miquelon", aliases: [], primaryTimezone: "America/Miquelon" }],
  ["PN", { alpha2: "PN", alpha3: "PCN", name: "pitcairn", aliases: ["pitcairn islands"], primaryTimezone: "Pacific/Pitcairn" }],
  ["PR", { alpha2: "PR", alpha3: "PRI", name: "puerto rico", aliases: [], primaryTimezone: "America/Puerto_Rico" }],
  ["PS", { alpha2: "PS", alpha3: "PSE", name: "palestine", aliases: ["state of palestine", "palestinian territory"], primaryTimezone: "Asia/Gaza" }],
  ["PT", { alpha2: "PT", alpha3: "PRT", name: "portugal", aliases: [], primaryTimezone: "Europe/Lisbon" }],
  ["PW", { alpha2: "PW", alpha3: "PLW", name: "palau", aliases: [], primaryTimezone: "Pacific/Palau" }],
  ["PY", { alpha2: "PY", alpha3: "PRY", name: "paraguay", aliases: [], primaryTimezone: "America/Asuncion" }],

  // Q
  ["QA", { alpha2: "QA", alpha3: "QAT", name: "qatar", aliases: [], primaryTimezone: "Asia/Qatar" }],

  // R
  ["RE", { alpha2: "RE", alpha3: "REU", name: "reunion", aliases: [], primaryTimezone: "Indian/Reunion" }],
  ["RO", { alpha2: "RO", alpha3: "ROU", name: "romania", aliases: [], primaryTimezone: "Europe/Bucharest" }],
  ["RS", { alpha2: "RS", alpha3: "SRB", name: "serbia", aliases: [], primaryTimezone: "Europe/Belgrade" }],
  ["RU", { alpha2: "RU", alpha3: "RUS", name: "russia", aliases: ["russian federation"], primaryTimezone: "Europe/Moscow" }],
  ["RW", { alpha2: "RW", alpha3: "RWA", name: "rwanda", aliases: [], primaryTimezone: "Africa/Kigali" }],

  // S
  ["SA", { alpha2: "SA", alpha3: "SAU", name: "saudi arabia", aliases: ["ksa"], primaryTimezone: "Asia/Riyadh" }],
  ["SB", { alpha2: "SB", alpha3: "SLB", name: "solomon islands", aliases: [], primaryTimezone: "Pacific/Guadalcanal" }],
  ["SC", { alpha2: "SC", alpha3: "SYC", name: "seychelles", aliases: [], primaryTimezone: "Indian/Mahe" }],
  ["SD", { alpha2: "SD", alpha3: "SDN", name: "sudan", aliases: [], primaryTimezone: "Africa/Khartoum" }],
  ["SE", { alpha2: "SE", alpha3: "SWE", name: "sweden", aliases: [], primaryTimezone: "Europe/Stockholm" }],
  ["SG", { alpha2: "SG", alpha3: "SGP", name: "singapore", aliases: [], primaryTimezone: "Asia/Singapore" }],
  ["SH", { alpha2: "SH", alpha3: "SHN", name: "saint helena", aliases: ["st helena"], primaryTimezone: "Atlantic/St_Helena" }],
  ["SI", { alpha2: "SI", alpha3: "SVN", name: "slovenia", aliases: [], primaryTimezone: "Europe/Ljubljana" }],
  ["SJ", { alpha2: "SJ", alpha3: "SJM", name: "svalbard and jan mayen", aliases: [], primaryTimezone: "Arctic/Longyearbyen" }],
  ["SK", { alpha2: "SK", alpha3: "SVK", name: "slovakia", aliases: ["slovak republic"], primaryTimezone: "Europe/Bratislava" }],
  ["SL", { alpha2: "SL", alpha3: "SLE", name: "sierra leone", aliases: [], primaryTimezone: "Africa/Freetown" }],
  ["SM", { alpha2: "SM", alpha3: "SMR", name: "san marino", aliases: [], primaryTimezone: "Europe/San_Marino" }],
  ["SN", { alpha2: "SN", alpha3: "SEN", name: "senegal", aliases: [], primaryTimezone: "Africa/Dakar" }],
  ["SO", { alpha2: "SO", alpha3: "SOM", name: "somalia", aliases: [], primaryTimezone: "Africa/Mogadishu" }],
  ["SR", { alpha2: "SR", alpha3: "SUR", name: "suriname", aliases: [], primaryTimezone: "America/Paramaribo" }],
  ["SS", { alpha2: "SS", alpha3: "SSD", name: "south sudan", aliases: [], primaryTimezone: "Africa/Juba" }],
  ["ST", { alpha2: "ST", alpha3: "STP", name: "sao tome and principe", aliases: [], primaryTimezone: "Africa/Sao_Tome" }],
  ["SV", { alpha2: "SV", alpha3: "SLV", name: "el salvador", aliases: [], primaryTimezone: "America/El_Salvador" }],
  ["SX", { alpha2: "SX", alpha3: "SXM", name: "sint maarten", aliases: [], primaryTimezone: "America/Lower_Princes" }],
  ["SY", { alpha2: "SY", alpha3: "SYR", name: "syria", aliases: ["syrian arab republic"], primaryTimezone: "Asia/Damascus" }],
  ["SZ", { alpha2: "SZ", alpha3: "SWZ", name: "eswatini", aliases: ["swaziland"], primaryTimezone: "Africa/Mbabane" }],

  // T
  ["TC", { alpha2: "TC", alpha3: "TCA", name: "turks and caicos islands", aliases: [], primaryTimezone: "America/Grand_Turk" }],
  ["TD", { alpha2: "TD", alpha3: "TCD", name: "chad", aliases: [], primaryTimezone: "Africa/Ndjamena" }],
  ["TF", { alpha2: "TF", alpha3: "ATF", name: "french southern territories", aliases: [], primaryTimezone: "Indian/Kerguelen" }],
  ["TG", { alpha2: "TG", alpha3: "TGO", name: "togo", aliases: [], primaryTimezone: "Africa/Lome" }],
  ["TH", { alpha2: "TH", alpha3: "THA", name: "thailand", aliases: [], primaryTimezone: "Asia/Bangkok" }],
  ["TJ", { alpha2: "TJ", alpha3: "TJK", name: "tajikistan", aliases: [], primaryTimezone: "Asia/Dushanbe" }],
  ["TK", { alpha2: "TK", alpha3: "TKL", name: "tokelau", aliases: [], primaryTimezone: "Pacific/Fakaofo" }],
  ["TL", { alpha2: "TL", alpha3: "TLS", name: "timor-leste", aliases: ["east timor"], primaryTimezone: "Asia/Dili" }],
  ["TM", { alpha2: "TM", alpha3: "TKM", name: "turkmenistan", aliases: [], primaryTimezone: "Asia/Ashgabat" }],
  ["TN", { alpha2: "TN", alpha3: "TUN", name: "tunisia", aliases: [], primaryTimezone: "Africa/Tunis" }],
  ["TO", { alpha2: "TO", alpha3: "TON", name: "tonga", aliases: [], primaryTimezone: "Pacific/Tongatapu" }],
  ["TR", { alpha2: "TR", alpha3: "TUR", name: "turkey", aliases: ["turkiye"], primaryTimezone: "Europe/Istanbul" }],
  ["TT", { alpha2: "TT", alpha3: "TTO", name: "trinidad and tobago", aliases: ["trinidad"], primaryTimezone: "America/Port_of_Spain" }],
  ["TV", { alpha2: "TV", alpha3: "TUV", name: "tuvalu", aliases: [], primaryTimezone: "Pacific/Funafuti" }],
  ["TW", { alpha2: "TW", alpha3: "TWN", name: "taiwan", aliases: [], primaryTimezone: "Asia/Taipei" }],
  ["TZ", { alpha2: "TZ", alpha3: "TZA", name: "tanzania", aliases: ["united republic of tanzania"], primaryTimezone: "Africa/Dar_es_Salaam" }],

  // U
  ["UA", { alpha2: "UA", alpha3: "UKR", name: "ukraine", aliases: [], primaryTimezone: "Europe/Kiev" }],
  ["UG", { alpha2: "UG", alpha3: "UGA", name: "uganda", aliases: [], primaryTimezone: "Africa/Kampala" }],
  ["UM", { alpha2: "UM", alpha3: "UMI", name: "united states minor outlying islands", aliases: [], primaryTimezone: "Pacific/Midway" }],
  ["US", { alpha2: "US", alpha3: "USA", name: "united states", aliases: ["usa", "america", "united states of america", "the united states", "the us", "the usa"], primaryTimezone: "America/New_York" }],
  ["UY", { alpha2: "UY", alpha3: "URY", name: "uruguay", aliases: [], primaryTimezone: "America/Montevideo" }],
  ["UZ", { alpha2: "UZ", alpha3: "UZB", name: "uzbekistan", aliases: [], primaryTimezone: "Asia/Tashkent" }],

  // V
  ["VA", { alpha2: "VA", alpha3: "VAT", name: "vatican city", aliases: ["holy see", "vatican"], primaryTimezone: "Europe/Vatican" }],
  ["VC", { alpha2: "VC", alpha3: "VCT", name: "saint vincent and the grenadines", aliases: ["st vincent"], primaryTimezone: "America/St_Vincent" }],
  ["VE", { alpha2: "VE", alpha3: "VEN", name: "venezuela", aliases: [], primaryTimezone: "America/Caracas" }],
  ["VG", { alpha2: "VG", alpha3: "VGB", name: "british virgin islands", aliases: [], primaryTimezone: "America/Tortola" }],
  ["VI", { alpha2: "VI", alpha3: "VIR", name: "us virgin islands", aliases: ["united states virgin islands"], primaryTimezone: "America/Virgin" }],
  ["VN", { alpha2: "VN", alpha3: "VNM", name: "vietnam", aliases: ["viet nam"], primaryTimezone: "Asia/Ho_Chi_Minh" }],
  ["VU", { alpha2: "VU", alpha3: "VUT", name: "vanuatu", aliases: [], primaryTimezone: "Pacific/Efate" }],

  // W
  ["WF", { alpha2: "WF", alpha3: "WLF", name: "wallis and futuna", aliases: [], primaryTimezone: "Pacific/Wallis" }],
  ["WS", { alpha2: "WS", alpha3: "WSM", name: "samoa", aliases: [], primaryTimezone: "Pacific/Apia" }],

  // X - Kosovo (not in ISO 3166 but widely used)
  ["XK", { alpha2: "XK", alpha3: "XKX", name: "kosovo", aliases: [], primaryTimezone: "Europe/Belgrade" }],

  // Y
  ["YE", { alpha2: "YE", alpha3: "YEM", name: "yemen", aliases: [], primaryTimezone: "Asia/Aden" }],
  ["YT", { alpha2: "YT", alpha3: "MYT", name: "mayotte", aliases: [], primaryTimezone: "Indian/Mayotte" }],

  // Z
  ["ZA", { alpha2: "ZA", alpha3: "ZAF", name: "south africa", aliases: [], primaryTimezone: "Africa/Johannesburg" }],
  ["ZM", { alpha2: "ZM", alpha3: "ZMB", name: "zambia", aliases: [], primaryTimezone: "Africa/Lusaka" }],
  ["ZW", { alpha2: "ZW", alpha3: "ZWE", name: "zimbabwe", aliases: [], primaryTimezone: "Africa/Harare" }],
]);

/**
 * Reverse index: lowercase alias/name/alpha2/alpha3 -> alpha-2 code.
 * Built from COUNTRIES at module load time.
 */
export const COUNTRY_REVERSE_INDEX: ReadonlyMap<string, string> = (() => {
  const idx = new Map<string, string>();

  for (const [alpha2, record] of COUNTRIES) {
    // Index by lowercase alpha-2
    idx.set(alpha2.toLowerCase(), alpha2);
    // Index by lowercase alpha-3
    idx.set(record.alpha3.toLowerCase(), alpha2);
    // Index by canonical name
    idx.set(record.name, alpha2);
    // Index by each alias
    for (const alias of record.aliases) {
      idx.set(alias, alpha2);
    }
  }

  return idx;
})();

/**
 * Lookup a string as a country. Returns the ISO 3166-1 alpha-2 code or null.
 * Input is lowercased and trimmed before lookup.
 */
export function lookupCountry(input: string): string | null {
  const normalized = input.toLowerCase().trim();
  return COUNTRY_REVERSE_INDEX.get(normalized) ?? null;
}
