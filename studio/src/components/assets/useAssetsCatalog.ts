import { useEffect, useState } from "react";

export interface AssetItem {
  name: string;
  doc: string;
  thumb: string | null;
}
export interface IconItem {
  name: string;
  category: string;
  tags: string[];
  svg: string;
}
export interface AssetSection {
  kind: "composite" | "component" | "icon";
  items: AssetItem[] | IconItem[];
}
export interface Catalog {
  sections: AssetSection[];
}

type State =
  | { status: "loading" }
  | { status: "ready"; catalog: Catalog }
  | { status: "error" };

export function useAssetsCatalog(): State {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let live = true;
    fetch("/api/assets")
      .then((r) => {
        if (!r.ok) throw new Error("catalog unavailable");
        return r.json();
      })
      .then((catalog: Catalog) => {
        if (live) setState({ status: "ready", catalog });
      })
      .catch(() => {
        if (live) setState({ status: "error" });
      });
    return () => {
      live = false;
    };
  }, []);
  return state;
}
