import { Storage } from '@noeldemartin/utils';

import Service from '@/framework/core/Service';
import Services from '@/framework/core/Services';
import Authenticators from '@/framework/auth/Authenticators';
import type Authenticator from '@/framework/auth/Authenticator';
import type { AuthenticatorName } from '@/framework/auth/Authenticators';
import type { AuthSession } from '@/framework/auth/Authenticator';
import type { ComputedStateDefinitions , IService } from '@/framework/core/Service';

interface User {
    name: string;
}

interface State {
    session: AuthSession | null;
}

interface ComputedState {
    authenticator: Authenticator | null;
    loggedIn: boolean;
    user: User | null;
}

const STORAGE_KEY = 'auth';

interface StorageData {
    authenticator: AuthenticatorName;
}

export class Auth extends Service<State, ComputedState> {

    public isLoggedIn(): this is { user: User; authenticator: Authenticator } {
        return this.loggedIn;
    }

    public async login(authenticatorName: AuthenticatorName = 'default'): Promise<void> {
        if (this.loggedIn)
            return;

        try {
            const authenticator = await this.bootAuthenticator(authenticatorName);

            await authenticator.login();
        } catch (error) {
            console.error(error);

            alert('Could not log in');
        }
    }

    public async logout(): Promise<void> {
        if (!this.isLoggedIn())
            return;

        await this.authenticator.logout();
    }

    protected async boot(): Promise<void> {
        await super.boot();

        if (!Storage.has(STORAGE_KEY))
            return;

        const { authenticator } = Storage.require<StorageData>(STORAGE_KEY);

        await this.bootAuthenticator(authenticator);
    }

    protected getInitialState(): State {
        return {
            session: null,
        };
    }

    protected getComputedStateDefinitions(): ComputedStateDefinitions<State, ComputedState> {
        return {
            authenticator: state => state.session?.authenticator ?? null,
            loggedIn: state => state.session !== null,
            user: state => state.session?.user ?? null,
        };
    }

    private async bootAuthenticator(name: AuthenticatorName): Promise<Authenticator> {
        const authenticator = Authenticators[name];

        authenticator.addListener({
            onSessionStarted: async session => {
                this.session = session;

                Storage.set<StorageData>(STORAGE_KEY, { authenticator: session.authenticator.name });

                await Services.$events.emit('login', session.user);
            },
            onSessionEnded: async () => {
                this.session = null;

                Storage.remove(STORAGE_KEY);

                await Services.$events.emit('logout');
            },
        });

        await authenticator.boot();

        return authenticator;
    }

}

export interface Auth extends IService<State, ComputedState> {}
