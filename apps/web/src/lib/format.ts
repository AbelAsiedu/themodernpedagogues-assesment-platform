// Ghana-first date formatting (day before month). Times shown in the viewer's own time zone.
const dateTime = new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("en-GH", { dateStyle: "medium" });

export const fmtDateTime = (iso: string) => dateTime.format(new Date(iso));
export const fmtDate = (iso: string) => dateOnly.format(new Date(iso));
