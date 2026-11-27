import { serviceFor } from "../model/index.ts"
import type { HostName } from "./hosts.ts"

export const service = serviceFor<HostName>()
