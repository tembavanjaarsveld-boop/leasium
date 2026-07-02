export type XeroTaxTypeOption = {
  code: string;
  label: string;
  legacy?: boolean;
};

export const AU_XERO_TAX_TYPE_OPTIONS: XeroTaxTypeOption[] = [
  { code: "OUTPUT", label: "GST on Income" },
  { code: "INPUT", label: "GST on Expenses" },
  { code: "EXEMPTOUTPUT", label: "GST Free Income" },
  { code: "EXEMPTEXPENSES", label: "GST Free Expenses" },
  { code: "BASEXCLUDED", label: "BAS Excluded" },
];

export function xeroTaxTypeOptionsForValue(
  value: string | null | undefined,
): XeroTaxTypeOption[] {
  const currentValue = value ?? "";
  const trimmedValue = currentValue.trim();
  if (
    !trimmedValue ||
    AU_XERO_TAX_TYPE_OPTIONS.some((option) => option.code === currentValue)
  ) {
    return AU_XERO_TAX_TYPE_OPTIONS;
  }
  return [
    ...AU_XERO_TAX_TYPE_OPTIONS,
    {
      code: currentValue,
      label: `Legacy tax type: ${currentValue}`,
      legacy: true,
    },
  ];
}

export function xeroTaxTypeOptionLabel(option: XeroTaxTypeOption): string {
  return option.label;
}
