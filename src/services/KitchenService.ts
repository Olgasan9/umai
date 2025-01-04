import { arrayWithout, fail, required, value } from '@noeldemartin/utils';
import { toRaw } from 'vue';
import type { Falsy } from '@noeldemartin/utils';
import type { RouteLocationRaw } from 'vue-router';

import App from '@/framework/core/facades/App';
import Errors from '@/framework/core/facades/Errors';
import Events from '@/framework/core/facades/Events';
import Router from '@/framework/core/facades/Router';
import Service from '@/framework/core/Service';
import UI from '@/framework/core/facades/UI';
import type { ComputedStateDefinitions, IService } from '@/framework/core/Service';

import Dish from '@/models/Dish';
import Timer from '@/models/Timer';
import Viewer from '@/services/facades/Viewer';
import KitchenTimeoutModal from '@/routing/pages/kitchen/components/modals/KitchenTimeoutModal.vue';
import type Recipe from '@/models/Recipe';
import type { DishJson } from '@/models/Dish';
import type { TimerJson } from '@/models/Timer';

interface State {
    dishes: Dish[];
    timers: Timer[];
    dismissed: boolean;
    wakeLock: boolean;
    lastPage: {
        route: RouteLocationRaw;
        showLogo: boolean;
        fullBleedHeader: boolean | Falsy;
    } | null;
}

interface ComputedState {
    show: boolean;
}

interface PersistedState {
    dishes: DishJson[];
    timers: TimerJson[];
    wakeLock: boolean;
    lastPage: {
        route: RouteLocationRaw;
        showLogo: boolean;
        fullBleedHeader: boolean | Falsy;
    } | null;
}

export default class CookbookService extends Service<State, ComputedState, PersistedState> {

    public static persist: Array<keyof PersistedState> = ['dishes', 'timers', 'wakeLock', 'lastPage'];

    private screenLock: Promise<void | { release(): Promise<void> }> | null = null;
    private timeouts: WeakMap<Timer, ReturnType<typeof setTimeout>> = new WeakMap();

    public get active(): boolean {
        return Router.currentRouteIs(/^kitchen(\.[^.]+)?$/);
    }

    public findDish(recipe: Recipe): Dish | undefined {
        return this.dishes.find(dish => dish.recipe.is(recipe));
    }

    public async open(dish?: Dish): Promise<void> {
        if (this.dishes.length === 0) {
            return;
        }

        if (!this.active) {
            this.lastPage = {
                showLogo: Router.currentRoute.value.name === 'home',
                fullBleedHeader: value(Router.currentRoute.value.meta.fullBleedHeader as boolean | Falsy),
                route: {
                    name: Router.currentRoute.value.name ?? fail(),
                    params: Router.currentRoute.value.params,
                },
            };
        }

        if (dish || this.dishes.length === 1) {
            await Router.push(required(dish ?? this.dishes[0]).getStageRoute());

            return;
        }

        await Router.push({ name: 'kitchen' });
    }

    public async close(): Promise<void> {
        if (!this.lastPage) {
            return;
        }

        const route = this.lastPage.route;

        await Router.push(toRaw(route));

        this.lastPage = null;
    }

    public async cook(recipe: Recipe): Promise<void> {
        const dish = this.findDish(recipe) ?? this.addRecipe(recipe);

        await this.open(dish);
    }

    public addTimer(timer: Timer): void {
        this.timers = this.timers.concat([timer]);

        timer.listeners.add({
            onUpdated: () => this.onTimerUpdated(),
            onStartedRunning: () => this.onTimerStarted(timer),
            onStoppedRunning: () => this.onTimerStopped(timer),
        });
    }

    public removeTimer(timer: Timer): void {
        this.timers = arrayWithout(this.timers, timer);

        timer.stop();
    }

    public async complete(dish: Dish): Promise<void> {
        this.setState({ dishes: arrayWithout(this.dishes, dish) });

        if (this.dishes.length === 0) {
            this.releaseScreen();
        }

        await this.close();
    }

    public dismiss(): void {
        this.dismissed = true;
    }

    protected async boot(): Promise<void> {
        await super.boot();
        await Viewer.booted;

        Events.on('logout', () => {
            this.timers.forEach(timer => this.onTimerStopped(timer));

            this.setState({ dishes: [], timers: [], lastPage: null });
        });

        if (this.dishes.length > 0) {
            this.lockScreen();

            this.dishes.forEach(dish => {
                dish.listeners.add({ onUpdated: () => this.setState({ dishes: this.dishes.slice(0) }) });
            });

            this.timers.forEach(timer => {
                timer.listeners.add({
                    onUpdated: () => this.onTimerUpdated(),
                    onStartedRunning: () => this.onTimerStarted(timer),
                    onStoppedRunning: () => this.onTimerStopped(timer),
                });

                if (timer.isRunning() && !timer.isOverTime()) {
                    this.onTimerStarted(timer);
                }
            });
        }
    }

    protected getInitialState(): State {
        return {
            dishes: [],
            timers: [],
            dismissed: false,
            wakeLock: true,
            lastPage: null,
        };
    }

    protected getComputedStateDefinitions(): ComputedStateDefinitions<State, ComputedState> {
        return {
            show: ({ dismissed, dishes }) => {
                if (!App.isMounted || Viewer.active) {
                    return false;
                }

                if (dishes.length > 0) {
                    return true;
                }

                return !dismissed && Router.currentRouteIs(/^kitchen(\.[^.]+)?|recipes\.show$/);
            },
        };
    }

    protected serializePersistedState(state: Partial<State>): Partial<PersistedState> {
        const persistedState = state as Partial<PersistedState>;

        if (state.dishes) {
            persistedState.dishes = state.dishes.map(dish => dish.toJson());
        }

        if (state.timers) {
            persistedState.timers = state.timers.map(timer => timer.toJson());
        }

        return persistedState;
    }

    protected async restorePersistedState(state: PersistedState): Promise<Partial<State>> {
        return {
            ...state,
            dishes: await Promise.all(state.dishes.map(json => Dish.fromJson(json))),
            timers: state.timers.map(json => Timer.fromJson(json)),
        };
    }

    protected addRecipe(recipe: Recipe): Dish {
        const dish = new Dish(recipe);

        dish.listeners.add({ onUpdated: () => this.setState({ dishes: this.dishes.slice(0) }) });

        this.dishes.push(dish);

        if (this.dishes.length === 1) {
            this.lockScreen();
        }

        return dish;
    }

    protected lockScreen(): void {
        const typedNavigator = navigator as {
            wakeLock?: { request(type?: 'screen'): Promise<{ release(): Promise<void> }> };
        };

        if (!typedNavigator.wakeLock) {
            return;
        }

        try {
            this.screenLock = typedNavigator.wakeLock.request('screen').catch((error) => {
                Errors.reportDevelopmentError(error, 'Could not request screen wake lock');
            });
        } catch (error) {
            Errors.reportDevelopmentError(error, 'Could not request screen wake lock');
        }
    }

    protected releaseScreen(): void {
        if (!this.screenLock) {
            return;
        }

        this.screenLock.then(lock => lock?.release());
        this.screenLock = null;
    }

    protected onTimerUpdated(): void {
        this.setState({ timers: this.timers.slice(0) });
    }

    protected onTimerStarted(timer: Timer): void {
        if (this.timeouts.has(timer)) {
            return;
        }

        const timeout = setTimeout(() => {
            UI.openModal(KitchenTimeoutModal, { timer });

            this.timeouts.delete(timer);
            this.onTimerUpdated();
        }, timer.getTimeLeft());

        this.timeouts.set(timer, timeout);
    }

    protected onTimerStopped(timer: Timer): void {
        const timeout = this.timeouts.get(timer);

        if (!timeout) {
            return;
        }

        clearTimeout(timeout);
        this.timeouts.delete(timer);
    }

}

export default interface CookbookService extends IService<State, ComputedState> {}
