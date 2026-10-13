import type { InputHTMLAttributes } from "react";
import { t } from "../lib";

/** Campo de texto con una «✕» a la derecha para borrar todo de un clic (útil al pegar claves). */
export default function ClearableInput({ value, onValueChange, className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & { value: string; onValueChange: (v: string) => void }) {
  return (
    <div className="relative">
      <input value={value} onChange={(e) => onValueChange(e.target.value)} className={`${className ?? ""} ${value ? "pr-9" : ""}`} {...rest} />
      {value && (
        <button type="button" onClick={() => onValueChange("")} aria-label={t("Borrar")} title={t("Borrar")} className="absolute inset-y-0 right-1 grid w-7 place-items-center rounded text-[13px] font-bold text-dim hover:text-snow">
          ✕
        </button>
      )}
    </div>
  );
}
