import { useQuery } from "@tanstack/react-query";
import { isDev } from "./source";
import { supabase } from "./supabase";

export interface Acesso {
  email: string;
  admin: boolean;
  incluido_em: string;
  incluido_por: string | null;
}

const DEV_KEY = "acessos-dev";
function devLista(): Acesso[] {
  try {
    return JSON.parse(localStorage.getItem(DEV_KEY) ?? "null") ??
      [{ email: "luq.marqs@gmail.com", admin: true, incluido_em: new Date().toISOString(), incluido_por: null }];
  } catch {
    return [];
  }
}
function devSalvar(l: Acesso[]) {
  try {
    localStorage.setItem(DEV_KEY, JSON.stringify(l));
  } catch {
    /* sem armazenamento: vale só nesta sessão */
  }
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const acessos = {
  souAdmin: () => (isDev ? Promise.resolve(true) : rpc<boolean>("sou_admin")),
  listar: () => (isDev ? Promise.resolve(devLista()) : rpc<Acesso[]>("listar_autorizados")),
  async adicionar(email: string, admin: boolean) {
    const e = email.trim().toLowerCase();
    if (isDev) {
      devSalvar([...devLista().filter((x) => x.email !== e), { email: e, admin, incluido_em: new Date().toISOString(), incluido_por: "dev" }]);
      return;
    }
    await rpc("adicionar_autorizado", { p_email: e, p_admin: admin });
  },
  async remover(email: string) {
    if (isDev) {
      devSalvar(devLista().filter((x) => x.email !== email));
      return;
    }
    await rpc("remover_autorizado", { p_email: email });
  },
};

export function useSouAdmin() {
  return useQuery({ queryKey: ["sou-admin"], queryFn: acessos.souAdmin, staleTime: 60_000 });
}
