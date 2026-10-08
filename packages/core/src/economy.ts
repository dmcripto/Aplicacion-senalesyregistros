// ─── VELTRIX · Agenda económica (compartido por web y app) ───
// Nombres en español de los datos económicos. Es la misma tabla que usa el servidor (supabase/functions/_shared/economy.ts); una prueba comprueba que den lo mismo.

const ES: Array<[RegExp, string]> = [
  [/\bADP Non-Farm Employment Change\b/i, "Empleo privado ADP"],
  [/\bNon-Farm Employment Change\b/i, "Empleo no agrícola (NFP)"],
  [/\bEmployment Change\b/i, "Cambio en el empleo"],
  [/\bUnemployment Rate\b/i, "Tasa de desempleo"],
  [/\bUnemployment Claims\b/i, "Pedidos de subsidio por desempleo"],
  [/\bAverage Hourly Earnings\b/i, "Salario promedio por hora"],
  [/\bCore CPI\b/i, "Inflación subyacente (Core CPI)"],
  [/\bCPI\b/i, "Inflación (CPI)"],
  [/\bCore PCE Price Index\b/i, "Inflación PCE subyacente"],
  [/\bPCE Price Index\b/i, "Inflación PCE"],
  [/\bCore PPI\b/i, "Precios al productor subyacentes (Core PPI)"],
  [/\bPPI\b/i, "Precios al productor (PPI)"],
  [/\bFOMC Meeting Minutes\b/i, "Minutas de la Fed (FOMC)"],
  [/\bFOMC Statement\b/i, "Comunicado de la Fed (FOMC)"],
  [/\bFOMC Press Conference\b/i, "Conferencia de prensa de la Fed"],
  [/\bFederal Funds Rate\b/i, "Tasa de interés de la Fed"],
  [/\bFOMC\b/i, "Fed (FOMC)"],
  [/\bMain Refinancing Rate\b/i, "Tasa de interés del BCE"],
  [/\bOfficial Bank Rate\b/i, "Tasa de interés del Banco de Inglaterra"],
  [/\bBOJ Policy Rate\b/i, "Tasa de interés del Banco de Japón"],
  [/\bCash Rate\b/i, "Tasa de interés del Banco de Australia"],
  [/\bOvernight Rate\b/i, "Tasa de interés del Banco de Canadá"],
  [/\bMonetary Policy Statement\b/i, "Comunicado de política monetaria"],
  [/\bRate Statement\b/i, "Comunicado de tasas"],
  [/\bBeige Book\b/i, "Libro Beige de la Fed"],
  [/\bCore Retail Sales\b/i, "Ventas minoristas subyacentes"],
  [/\bRetail Sales\b/i, "Ventas minoristas"],
  [/\bAdvance GDP\b/i, "PIB (adelanto)"],
  [/\bPrelim GDP\b/i, "PIB (preliminar)"],
  [/\bFinal GDP\b/i, "PIB (final)"],
  [/\bGDP\b/i, "PIB"],
  [/\bISM Manufacturing PMI\b/i, "PMI manufacturero ISM"],
  [/\bISM Services PMI\b/i, "PMI de servicios ISM"],
  [/\bManufacturing PMI\b/i, "PMI manufacturero"],
  [/\bServices PMI\b/i, "PMI de servicios"],
  [/\bJOLTS Job Openings\b/i, "Ofertas de empleo (JOLTS)"],
  [/\bConsumer Confidence\b/i, "Confianza del consumidor"],
  [/\bUnivers?ity of Michigan|Revised UoM|Prelim UoM\b/i, "Sentimiento del consumidor (Michigan)"],
  [/\bCrude Oil Inventories\b/i, "Inventarios de petróleo"],
  [/\bNatural Gas Storage\b/i, "Inventarios de gas natural"],
  [/\bDurable Goods Orders\b/i, "Pedidos de bienes duraderos"],
  [/\bIndustrial Production\b/i, "Producción industrial"],
  [/\bBuilding Permits\b/i, "Permisos de construcción"],
  [/\bHousing Starts\b/i, "Inicios de viviendas"],
  [/\bTrade Balance\b/i, "Balanza comercial"],
  [/\bBond Auction\b/i, "Subasta de bonos"],
];

/** Palabras sueltas (de los discursos): se cambian todas, además del nombre del dato. */
const WORDS: Array<[RegExp, string]> = [
  [/\bSpeaks\b/g, "habla"],
  [/\bMember\b/g, "miembro"],
  [/\bGovernor\b/g, "gobernador"],
  [/\bGov\b/g, "gobernador"],
  [/\bPresident\b/g, "presidente"],
  [/\bChair\b/g, "titular"],
];

/** Nombre en español de los datos más conocidos; si no se reconoce, queda el original. */
export function econTitleEs(title: string): string {
  let s = String(title).trim();
  for (const [re, es] of ES) {
    if (re.test(s)) {
      s = s.replace(re, es);
      break;
    }
  }
  for (const [re, es] of WORDS) s = s.replace(re, es);
  return s;
}
