import { PropertyWorkspace } from "@/components/property-workspace";

type PropertiesPageSearchParams = Promise<{
  action?: string | string[];
  view?: string | string[];
}>;

function initialPropertyView(value: string | string[] | undefined) {
  const view = Array.isArray(value) ? value[0] : value;
  if (
    view === "board" ||
    view === "table" ||
    view === "map" ||
    view === "calendar"
  ) {
    return view;
  }
  return "table";
}

function initialPropertyAction(value: string | string[] | undefined) {
  const action = Array.isArray(value) ? value[0] : value;
  return action === "new" ? "new" : undefined;
}

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams?: PropertiesPageSearchParams;
}) {
  const params = searchParams ? await searchParams : {};
  return (
    <PropertyWorkspace
      initialAction={initialPropertyAction(params.action)}
      initialView={initialPropertyView(params.view)}
    />
  );
}
