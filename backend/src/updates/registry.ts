/**
 * Vulnerability / detection feeds the platform keeps current. Each maps to a
 * standard tool's self-update command, run on the Kali worker.
 */
export interface UpdateSource {
  id: string;
  label: string;
  description: string;
  bin: string;
  updateArgs: string[];
  versionArgs?: string[];
  timeoutMs: number;
}

export const UPDATE_SOURCES: UpdateSource[] = [
  {
    id: "nuclei-templates",
    label: "Nuclei vulnerability templates",
    description: "Community vulnerability signatures used by web_vuln_scan.",
    bin: "nuclei",
    updateArgs: ["-update-templates"],
    versionArgs: ["-version"],
    timeoutMs: 480_000,
  },
  {
    id: "exploitdb",
    label: "Exploit-DB (searchsploit)",
    description: "Public exploit database queried by exploit_search.",
    bin: "searchsploit",
    updateArgs: ["-u"],
    // First run does a full git clone of the exploit-db repo (large/slow); give
    // it room under the worker's 600s cap. Subsequent runs are fast git pulls.
    timeoutMs: 570_000,
  },
  {
    id: "nmap-nse",
    label: "Nmap NSE script database",
    description: "Nmap Scripting Engine detection scripts.",
    bin: "nmap",
    updateArgs: ["--script-updatedb"],
    versionArgs: ["-version"],
    timeoutMs: 180_000,
  },
];
