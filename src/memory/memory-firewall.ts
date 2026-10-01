import type {MemoryRecord} from "./memory.js";
export class MemoryFirewall{
 private readonly forbidden=/(api[_ -]?key|secret|password|private[_ -]?key|access[_ -]?token)/i;
 sanitize(record:MemoryRecord):MemoryRecord{
  if(this.forbidden.test(record.content))throw new Error("Memory firewall rejected sensitive content.");
  return record;
 }
}
