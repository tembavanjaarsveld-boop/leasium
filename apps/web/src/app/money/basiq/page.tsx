import { redirect } from "next/navigation";

export default function MoneyBasiqRedirect() {
  redirect("/settings?tab=xero");
}
