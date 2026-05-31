import { redirect } from "next/navigation";

export default function MoneyBillingRedirect() {
  redirect("/billing-readiness");
}
