import { redirect } from "next/navigation";

export default function MoneyXeroRedirect() {
  redirect("/settings?tab=xero");
}
