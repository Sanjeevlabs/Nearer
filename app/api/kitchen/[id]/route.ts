import { requireSession } from "@/lib/auth";
import { getDoc, listDocs } from "@/lib/family-docs";
import { recipeIn } from "@/lib/kitchen";
import { toLangCode } from "@/lib/languages";
import { guardApi } from "@/lib/api-guard";

// One recipe, in the reader's language (Muse translates the whole card once
// per language and caches it), with everyone's attempts.
async function getHandler(req: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const recipe = await getDoc(auth.familyId, "recipe", params.id);
  if (!recipe) return Response.json({ error: "unknown-recipe" }, { status: 404 });
  const lang = toLangCode(new URL(req.url).searchParams.get("lang"));
  const [shown, attempts] = await Promise.all([recipeIn(auth.familyId, recipe, lang), listDocs(auth.familyId, "attempt")]);
  return Response.json({ recipe: shown, original: recipe, translated: shown.lang !== recipe.lang, attempts: attempts.filter((a) => a.recipeId === recipe.id) });
}

export const GET = guardApi(getHandler);
