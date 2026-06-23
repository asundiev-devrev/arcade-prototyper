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

export interface UserComponent {
  name: string;
  description: string;
  createdAt: string;
  origin: string;
  /** True when a rendered PNG thumbnail exists for this component. */
  thumb?: boolean;
}

export function useUserComponents(): { items: UserComponent[]; reload: () => void } {
  const [items, setItems] = useState<UserComponent[]>([]);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    fetch("/api/components")
      .then((r) => r.json())
      .then((d) => {
        if (live) setItems(Array.isArray(d.components) ? d.components : []);
      })
      .catch(() => {
        if (live) setItems([]);
      });
    return () => {
      live = false;
    };
  }, [nonce]);
  return { items, reload: () => setNonce((n) => n + 1) };
}
