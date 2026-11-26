/**
 * NestJS controller: the route is declared by decorators, `@Controller` for the path prefix and
 * `@Get` for the method and the rest of the path, on the method that serves it. No line elsewhere
 * names the handler. NestJS decorators are the legacy (experimentalDecorators) kind; this folder's
 * tsconfig.json turns them on.
 */

import { Controller, Get, NotFoundException, Param } from "@nestjs/common";

import { routedOrder, type RoutedOrder } from "@atelier/routes/orders";

@Controller("api/nest/orders")
export class OrdersController {
    @Get(":reference")
    show(@Param("reference") reference: string): RoutedOrder {
        const order = routedOrder(reference);
        if (order === undefined) {
            throw new NotFoundException(`no order ${reference}`);
        }

        return order;
    }
}
