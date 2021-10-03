import type { TestingRuntime, TestingStartOptions } from '@/types/testing';

import { patchWindow } from './ui';
import { queueAuthenticatedRequests } from './auth';

export default {

    testingRuntime(): Cypress.Chainable<TestingRuntime> {
        return cy.window().its('testing').then(runtime => runtime as TestingRuntime);
    },

    startApp(options: Partial<TestingStartOptions> = {}): void {
        cy.window().then((window: Window) => {
            patchWindow(window);
            queueAuthenticatedRequests(window);

            return Cypress.Promise.cast(window.testing?.start(options));
        });
    },

    waitForReload(options: Partial<TestingStartOptions> = {}): void {
        cy.get('#app.loading').then(() => cy.startApp(options));
    },

};
