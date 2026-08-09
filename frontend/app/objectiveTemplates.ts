// Objective templates to help operators (esp. beginners) craft agent objectives.
// Three levels per target category. <TARGET> is replaced with the engagement's
// first in-scope target when inserted. A common reporting suffix is appended so
// every run produces findings with impact/risk/remediation and a report.

export type Level = "basic" | "medium" | "advanced";

export interface TemplateCategory {
  key: string;
  label: string; // shown in the picker
  levels: Record<Level, string>;
}

const SUFFIX =
  " For every confirmed issue, record a finding via save_finding including the evidence, the business impact, a risk rating, and a concrete remediation recommendation. When finished, call generate_report.";

export const LEVEL_LABEL: Record<Level, string> = {
  basic: "Basic (มือใหม่ · ปลอดภัย เน้นสำรวจ)",
  medium: "Medium (สแกน + หาช่องโหว่ + ทดสอบรหัสผ่าน)",
  advanced: "Advanced (ยืนยันช่องโหว่ + เจาะ/ประเมินผลกระทบ)",
};

export const CATEGORIES: TemplateCategory[] = [
  {
    key: "web",
    label: "Web Application (เว็บ)",
    levels: {
      basic:
        "Perform passive and light reconnaissance of the web target <TARGET>: resolve DNS, inspect HTTP security headers, identify the technology stack, and do light content/path discovery. Report the posture and any missing security controls.",
      medium:
        "Assess the web application at <TARGET>: enumerate content and paths, run a vulnerability scan (nuclei) for common web flaws (injection, XSS, security misconfigurations, exposed admin panels), and test any login interfaces for weak or default credentials.",
      advanced:
        "Conduct an in-depth web assessment of <TARGET>: identify and validate exploitable vulnerabilities (injection, authentication bypass, known CVEs), demonstrate impact with a minimal approved proof-of-concept, and assess how far an attacker could pivot.",
    },
  },
  {
    key: "network",
    label: "Network / Infrastructure (เครือข่าย)",
    levels: {
      basic:
        "Map the network host <TARGET>: identify open ports and running services with a polite scan and note the detected service versions and exposed attack surface.",
      medium:
        "Assess the network target <TARGET>: perform full service/version enumeration, search for known public exploits (searchsploit) matching the discovered versions, and test exposed services (SSH/FTP/SMB/etc.) for weak credentials.",
      advanced:
        "Perform an in-depth infrastructure assessment of <TARGET>: validate exploitable services, attempt approved exploitation to confirm real impact, and assess lateral-movement and persistence exposure within scope.",
    },
  },
  {
    key: "os",
    label: "Operating System / Host (OS / เครื่อง)",
    levels: {
      basic:
        "Fingerprint the host <TARGET>: identify the operating system and exposed services, and flag any outdated or known-vulnerable service versions.",
      medium:
        "Assess the host <TARGET>: enumerate services, check for known vulnerabilities and default credentials on management services (SSH / RDP / SMB / WinRM), and identify misconfigurations.",
      advanced:
        "Perform a host compromise assessment of <TARGET>: validate exploitable weaknesses, assess privilege-escalation and persistence exposure, and document what an attacker could realistically achieve on the system.",
    },
  },
  {
    key: "database",
    label: "Database (MySQL/PostgreSQL/MSSQL/Mongo/Oracle/Redis)",
    levels: {
      basic:
        "Identify database services on <TARGET>: detect the database engine and version (MySQL, PostgreSQL, MSSQL, MongoDB, Oracle, Redis) and whether it is exposed or unauthenticated.",
      medium:
        "Assess the database on <TARGET>: check for default/weak credentials and anonymous access, and look up known CVEs for the detected engine; note the exposed-data risk.",
      advanced:
        "Perform an in-depth database security assessment of <TARGET>: validate weak-auth or exposed access, demonstrate data-exposure impact within scope, and assess data-exfiltration risk specific to the detected engine.",
    },
  },
  {
    key: "firewall",
    label: "Firewall / Perimeter (ไฟร์วอลล์ / ขอบเขต)",
    levels: {
      basic:
        "Assess the perimeter of <TARGET>: identify which ports and services are reachable through the firewall and describe the externally exposed attack surface.",
      medium:
        "Assess the perimeter/firewall of <TARGET>: enumerate reachable services, identify exposed management interfaces, and check for known firewall/appliance CVEs and default credentials.",
      advanced:
        "Perform an in-depth perimeter assessment of <TARGET>: validate exposed or misconfigured services, test for filtering-bypass exposure, and assess what an external attacker could reach — strictly within scope.",
    },
  },
  {
    key: "full",
    label: "Full Engagement (ครบทุกชั้น)",
    levels: {
      basic:
        "Run a full but safe assessment of <TARGET>: reconnaissance (DNS, ports, services), technology identification, and a baseline vulnerability scan. Summarize the overall security posture.",
      medium:
        "Run a full assessment of <TARGET>: recon → service enumeration → vulnerability scanning → weak-credential checks across the web, network, and host layers.",
      advanced:
        "Run a comprehensive penetration test of <TARGET> across web, network, host, and database layers: recon, vulnerability identification, validated exploitation of confirmed issues (with approval), and post-exploitation / persistence impact assessment.",
    },
  },
  {
    key: "exploit",
    label: "Exploitation & Post-Exploitation (Red Team · ทดสอบโจมตี)",
    levels: {
      basic:
        "Validate that the vulnerabilities already identified on <TARGET> are genuinely exploitable. For each confirmed weakness, demonstrate exploitability with a MINIMAL, non-destructive proof-of-concept (operator-approved), and document the confirmed attack path. Do not disrupt the service.",
      medium:
        "Perform controlled exploitation of <TARGET> (operator-approved, non-destructive): exploit a confirmed vulnerability to gain initial access, then assess local privilege-escalation exposure and enumerate what an attacker could read or control. Capture evidence of access only — do not modify or damage anything.",
      advanced:
        "Conduct a red-team style post-exploitation assessment of <TARGET>, strictly within scope and with operator approval for each step: from an initial foothold, assess privilege escalation, persistence/backdoor EXPOSURE (identify where an attacker could establish persistence — assess only, do NOT install or leave anything behind), lateral-movement potential to other in-scope hosts, and sensitive-data access. Document the full attack chain and blast radius.",
    },
  },
];

export function buildObjective(categoryKey: string, level: Level, target: string): string {
  const cat = CATEGORIES.find((c) => c.key === categoryKey);
  if (!cat) return "";
  const base = cat.levels[level].replaceAll("<TARGET>", target || "<TARGET>");
  return base + SUFFIX;
}

/** Flat list of all built-in templates — used as "copy from" sources when creating a custom one. */
export function builtinList(): { key: string; label: string; objective: string }[] {
  const out: { key: string; label: string; objective: string }[] = [];
  for (const c of CATEGORIES) {
    for (const lvl of ["basic", "medium", "advanced"] as Level[]) {
      out.push({
        key: `${c.key}:${lvl}`,
        label: `${c.label} · ${lvl}`,
        objective: buildObjective(c.key, lvl, "<TARGET>"),
      });
    }
  }
  return out;
}
