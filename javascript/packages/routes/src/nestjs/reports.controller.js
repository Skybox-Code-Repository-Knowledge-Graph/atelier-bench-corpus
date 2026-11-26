/**
 * NestJS without decorator syntax. Node runs this file as plain JavaScript,
 * which has no `@Decorator` syntax, so each Nest decorator is applied as the
 * function it is: `Controller(prefix)(Class)`, `Get(path)(prototype, name,
 * descriptor)`, `Param(name)(prototype, name, index)`. The route is the
 * controller prefix plus the method path, and the handler is named by string.
 */

import "reflect-metadata";
import { Controller, Get, Module, NotFoundException, Param } from "@nestjs/common";

import { reportPayload } from "../reportPayload.js";

export class ReportsController {
    /**
     * @param {string} slug
     * @returns {import("../reportPayload.js").ReportPayload}
     */
    show(slug) {
        const payload = reportPayload(slug);
        if (payload === undefined) {
            throw new NotFoundException(`unknown report ${slug}`);
        }
        return payload;
    }
}

/**
 * @param {string} name
 * @returns {PropertyDescriptor}
 */
const descriptor = (name) => /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(ReportsController.prototype, name));

Controller("api/reports")(ReportsController);
Get(":slug")(ReportsController.prototype, "show", descriptor("show"));
Param("slug")(ReportsController.prototype, "show", 0);

export class ReportsModule {}

Module({ controllers: [ReportsController] })(ReportsModule);
