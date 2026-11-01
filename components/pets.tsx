"use client";

import { useState } from "react";
import type { Pet } from "@/lib/kinds";
import { PET_SPECIES } from "@/lib/kind-values";
import { can } from "@/lib/permissions";
import { callName } from "@/lib/people";
import { postJson, useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { ActionMenu, Button, Icon, Monogram, SectionTitle } from "./ui/kit";
import { useViewer } from "./viewer";

const SPECIES_LABEL: Record<(typeof PET_SPECIES)[number], string> = { dog: "Dog", cat: "Cat", bird: "Bird", fish: "Fish", rabbit: "Rabbit", other: "Other" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const field = "h-[48px] w-full rounded-[14px] bg-white px-4 text-body outline-none focus:ring-2 focus:ring-marigold";

/** Pets are family: they live in a home, with a person. */
export function PetsSection() {
  const { viewer, members } = useViewer();
  const { data, reload } = useJson<{ pets: Pet[] }>("/api/pets");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const pets = data?.pets ?? [];
  const mayEdit = can(viewer, "tree.add");
  return (
    <section aria-label="Pets">
      <SectionTitle>Pets</SectionTitle>
      {pets.length === 0 && <p className="m-0 text-body text-ink-soft">No pets yet. They&rsquo;re family too.</p>}
      <ul className="m-0 list-none space-y-2 p-0">
        {pets.map((p) =>
          editing === p.id ? (
            <li key={p.id}>
              <PetForm pet={p} onDone={async () => { setEditing(null); await reload(); }} />
            </li>
          ) : (
            <li key={p.id} className="flex items-center gap-3 rounded-card bg-surface p-3">
              <span className="relative block h-12 w-12 shrink-0 overflow-hidden" style={{ borderRadius: "40% 40% 46% 46%" }}>
                <Monogram name={p.name} size={48} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold">{p.name}</span>
                <span className="block truncate text-footnote text-ink-soft">
                  {SPECIES_LABEL[p.species]} · lives with {callName(members.find((m) => m.id === p.livesWith))}
                  {p.birthday ? ` · ${MONTHS[Number(p.birthday.slice(0, 2)) - 1]} ${Number(p.birthday.slice(3))}` : ""}
                </span>
                {p.note && <span className="voice block truncate text-body">{p.note}</span>}
              </span>
              {mayEdit && (
                <ActionMenu
                  label={`${p.name} options`}
                  actions={[
                    { label: "Edit", onSelect: () => setEditing(p.id) },
                    { label: "Remove", danger: true, confirm: `Remove ${p.name}?`, onSelect: async () => { await postJson("/api/pets", { action: "remove", petId: p.id }); await reload(); } },
                  ]}
                />
              )}
            </li>
          ),
        )}
      </ul>
      {mayEdit &&
        (editing === "new" ? (
          <div className="mt-2">
            <PetForm onDone={async () => { setEditing(null); await reload(); }} />
          </div>
        ) : (
          <button type="button" onClick={() => setEditing("new")} className="press mt-2 flex h-11 items-center gap-1.5 text-body font-semibold">
            <Icon name="plus" size={18} />
            Add a pet
          </button>
        ))}
    </section>
  );
}

function PetForm({ pet, onDone }: { pet?: Pet; onDone: () => void }) {
  const { viewer, members } = useViewer();
  const [name, setName] = useState(pet?.name ?? "");
  const [species, setSpecies] = useState<Pet["species"]>(pet?.species ?? "dog");
  const [livesWith, setLivesWith] = useState(pet?.livesWith ?? viewer.id);
  const [month, setMonth] = useState(pet?.birthday.slice(0, 2) ?? "");
  const [day, setDay] = useState(pet?.birthday.slice(3, 5) ?? "");
  const [note, setNote] = useState(pet?.note ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2 rounded-card bg-surface p-3">
      <input className={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Name (Bruno)" aria-label="Pet's name" />
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind of pet">
        {PET_SPECIES.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={species === s} onClick={() => setSpecies(s)} className={cn("press h-9 rounded-full px-3.5 text-callout font-medium", species === s ? "bg-black text-white" : "bg-white")}>
            {SPECIES_LABEL[s]}
          </button>
        ))}
      </div>
      <select className={field} value={livesWith} onChange={(e) => setLivesWith(e.target.value)} aria-label="Lives with">
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            Lives with {m.id === viewer.id ? "me" : callName(m)}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <select className={field} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Birthday or gotcha day month">
          <option value="">Birthday (optional)</option>
          {MONTHS.map((mo, i) => (
            <option key={mo} value={String(i + 1).padStart(2, "0")}>
              {mo}
            </option>
          ))}
        </select>
        <select className={field} value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day">
          <option value="">Day</option>
          {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")).map((d) => (
            <option key={d} value={d}>
              {Number(d)}
            </option>
          ))}
        </select>
      </div>
      <input className={field} value={note} onChange={(e) => setNote(e.target.value)} maxLength={160} placeholder="Something about them (optional)" aria-label="Note" />
      <div className="flex gap-2">
        <Button
          className="h-11 flex-1 text-body"
          disabled={busy || !name.trim()}
          onClick={async () => {
            setBusy(true);
            const fields = { name: name.trim(), species, livesWith, birthday: month && day ? `${month}-${day}` : "", note: note.trim() };
            await postJson("/api/pets", pet ? { action: "edit", petId: pet.id, ...fields } : { action: "add", ...fields });
            setBusy(false);
            onDone();
          }}
        >
          {pet ? "Save" : "Add pet"}
        </Button>
        <Button variant="secondary" className="h-11 flex-1 !bg-white text-body" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
