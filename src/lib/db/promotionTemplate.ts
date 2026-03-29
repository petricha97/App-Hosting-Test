import { serverTimestamp } from "firebase/firestore";
import { createCollectionApi } from "@/lib/db/base";
import type { PromotionTemplateDoc } from "@/types/collection";

const promotionTemplateApi = createCollectionApi<PromotionTemplateDoc>("PromotionTemplate");

export { serverTimestamp };

export const {
    create: createPromotionTemplate,
    set: setPromotionTemplate,
    getById: getPromotionTemplateById,
    getAll: getPromotionTemplates,
    update: updatePromotionTemplate,
    remove: deletePromotionTemplate,
    findWhere: findPromotionTemplatesByField,
    findMany: findManyPromotionTemplates,
} = promotionTemplateApi;
