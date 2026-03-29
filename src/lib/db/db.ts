import { createAdminCollectionApi } from "@/lib/db/adminBase";
import type { TodoDoc } from "@/types/collection";

const todoApi = createAdminCollectionApi<TodoDoc>("todos");

export const {
    create: createTodo,
    set: setTodo,
    getById: getTodoById,
    getAll: getTodos,
    update: updateTodo,
    remove: deleteTodo,
    findWhere: findTodosByField,
} = todoApi;
