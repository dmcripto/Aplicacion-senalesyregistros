import { createContext, useContext } from "react";
import { NO_MONEY, rValueMoney } from "./lib";
import type { MoneySettings } from "./lib";

export interface MoneyCtx {
  money: MoneySettings;
  unit: number | null; // valor de 1R en dinero
}

export const MoneyContext = createContext<MoneyCtx>({ money: NO_MONEY, unit: null });
export const useMoney = () => useContext(MoneyContext);
export const makeMoneyCtx = (money: MoneySettings): MoneyCtx => ({ money, unit: rValueMoney(money) });
