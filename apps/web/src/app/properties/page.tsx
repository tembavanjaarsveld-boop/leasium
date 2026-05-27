import { PropertyWorkspace } from "@/components/property-workspace";

type PropertiesPageSearchParams = Promise<{
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

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams?: PropertiesPageSearchParams;
}) {
  const params = searchParams ? await searchParams : {};
  return <PropertyWorkspace initialView={initialPropertyView(params.view)} />;
}
