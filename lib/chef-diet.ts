const meat = /\b(?:meat|chicken|beef|pork|bacon|ham|lamb|mutton|turkey|duck|veal|venison|sausage|pepperoni|gelatin|lard|fish|anchov(?:y|ies)|salmon|tuna|cod|sardines?|seafood|prawns?|shrimp|crab|lobster|oysters?|mussels?|clams?|scallops?|eggs?|mayonnaise)\b/i;
const dairy = /\b(?:milk|cream|cheese|butter|ghee|yogh?urt|curd|paneer|whey|casein|kefir|honey)\b/i;
const alliums = /\b(?:onions?|garlic|shallots?|scallions?|leeks?|chives?|alliums?)\b/i;
const gluten = /\b(?:wheat|barley|rye|semolina|maida|atta|farro|spelt|bulgur|couscous|seitan|malt|soy sauce|breadcrumbs?)\b/i;

export function chefDietViolations(diet: string, ingredients: { item: string }[]): string[] {
  const vegan = /\bvegan\b/i.test(diet);
  const vegetarian = vegan || /\bvegetarian\b/i.test(diet);
  const noAlliums = /\b(?:no|without|free of)[ -]+(?:onions?|garlic|alliums?)\b|\b(?:onions?|garlic|alliums?)[ -]+free\b/i.test(diet);
  const noGluten = /\bgluten[ -]*free\b|\b(?:no|without) gluten\b/i.test(diet);
  return ingredients.map(({ item }) => item).filter((item) => {
    const animal = item.replace(/\b(?:plant-based|vegan|vegetarian|mock)\s+(?:chicken|beef|meat|fish|sausage|bacon|mayonnaise)\b/gi, "");
    const milk = item.replace(/\b(?:oat|soy|soya|almond|coconut|rice|cashew|plant-based|vegan)\s+(?:milk|cream|cheese|butter|yogh?urt)\b|\b(?:peanut|almond|cashew|cocoa) butter\b/gi, "");
    const grain = item.replace(/\bgluten[ -]*free\s+(?:soy sauce|breadcrumbs?)\b/gi, "");
    return (vegetarian && meat.test(animal)) || (vegan && dairy.test(milk)) || (noAlliums && alliums.test(item)) || (noGluten && gluten.test(grain));
  });
}

export function chefCalories(ingredients: { kcal: number }[], servings: number): number {
  return Math.round(ingredients.reduce((sum, ingredient) => sum + ingredient.kcal, 0) / servings);
}
