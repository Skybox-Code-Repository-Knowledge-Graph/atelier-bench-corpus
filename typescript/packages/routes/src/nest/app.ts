/** NestJS application over the Fastify adapter, whose inject() lets a test send requests with no listener. */

import "reflect-metadata";

import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";

import { OrdersController } from "./orders.controller";

@Module({ controllers: [OrdersController] })
export class OrdersModule {}

/** Create and initialise the app; the caller closes it. */
export async function createNestApp(): Promise<NestFastifyApplication> {
    const app = await NestFactory.create<NestFastifyApplication>(OrdersModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    return app;
}
