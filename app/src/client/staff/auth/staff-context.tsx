import { createContext, useContext } from "react";
import type { StaffMeta } from "@shared/staff/session.ts";

const StaffContext = createContext<StaffMeta | null>(null);

export const StaffProvider = StaffContext.Provider;

/** Who is signed in, their role, the repo and the Bot identity. Only rendered below a successful access check. */
export function useStaff(): StaffMeta {
  const meta = useContext(StaffContext);
  if (meta === null) throw new Error("useStaff must be used below the Staff layout");
  return meta;
}
