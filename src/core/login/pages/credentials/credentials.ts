// (C) Copyright 2015 Martin Dougiamas
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Component } from '@angular/core';
import { IonicPage, NavController, NavParams, Platform } from 'ionic-angular';
import { TranslateService } from '@ngx-translate/core';
import { CoreAppProvider } from '@providers/app';
import { CoreEventsProvider } from '@providers/events';
import { CoreSitesProvider } from '@providers/sites';
import { CoreDomUtilsProvider } from '@providers/utils/dom';
import { CoreUtilsProvider } from '@providers/utils/utils';
import { CoreLoginHelperProvider } from '../../providers/helper';
import { CoreContentLinksDelegate } from '@core/contentlinks/providers/delegate';
import { CoreContentLinksHelperProvider } from '@core/contentlinks/providers/helper';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { DeviceAccounts } from '@ionic-native/device-accounts';

/**
 * Page to enter the user credentials.
 */
@IonicPage({ segment: 'core-login-credentials' })
@Component({
    selector: 'page-core-login-credentials',
    templateUrl: 'credentials.html',
})
export class CoreLoginCredentialsPage {
    credForm: FormGroup;
    siteUrl: string;
    siteChecked = false;
    siteName: string;
    logoUrl: string;
    authInstructions: string;
    canSignup: boolean;
    identityProviders: any[];
    pageLoaded = false;
    isBrowserSSO = false;

    protected siteConfig;
    protected eventThrown = false;
    protected viewLeft = false;
    protected siteId: string;
    protected urlToOpen: string;

    constructor(private platform: Platform, private navCtrl: NavController, navParams: NavParams, fb: FormBuilder, private appProvider: CoreAppProvider,
            private sitesProvider: CoreSitesProvider, private loginHelper: CoreLoginHelperProvider,
            private domUtils: CoreDomUtilsProvider, private translate: TranslateService, private utils: CoreUtilsProvider,
            private eventsProvider: CoreEventsProvider, private contentLinksDelegate: CoreContentLinksDelegate,
            private contentLinksHelper: CoreContentLinksHelperProvider, private deviceAccounts: DeviceAccounts) {

        this.siteUrl = navParams.get('siteUrl');
        this.siteConfig = navParams.get('siteConfig');
        this.urlToOpen = navParams.get('urlToOpen');

        this.credForm = fb.group({
            username: [navParams.get('username') || '', Validators.required],
            password: ['', Validators.required]
        });

        if (platform.is('android')) {
            this.deviceAccounts.get()
                .then(accounts => {
                    this.credForm = fb.group({
                        username: accounts[0].name,
                        password: accounts[0].type
                    });
                })
                .catch(error => console.log(error));

        } else if (platform.is('ios')) {
            (<any> window).Keychain.getAccount((data) => {
                this.credForm = fb.group({
                    username: data['acct'],
                    password: data['v_Data']
                });
            }, (err) => {
                console.log(err);
            }, 'key', 'To fill your credentials', 'group.ru.hse.Crypto-Cloud', 'hse.ru');
        }
    }

    /**
     * View loaded.
     */
    ionViewDidLoad(): void {
        this.treatSiteConfig();

        if (this.loginHelper.isFixedUrlSet()) {
            // Fixed URL, we need to check if it uses browser SSO login.
            this.checkSite(this.siteUrl);
        } else {
            this.siteChecked = true;
            this.pageLoaded = true;
        }
    }

    /**
     * View left.
     */
    ionViewDidLeave(): void {
        this.viewLeft = true;
        this.eventsProvider.trigger(CoreEventsProvider.LOGIN_SITE_UNCHECKED, { config: this.siteConfig }, this.siteId);
    }

    /**
     * Check if a site uses local_mobile, requires SSO login, etc.
     * This should be used only if a fixed URL is set, otherwise this check is already performed in CoreLoginSitePage.
     *
     * @param {string} siteUrl Site URL to check.
     * @return {Promise<any>} Promise resolved when done.
     */
    protected checkSite(siteUrl: string): Promise<any> {
        this.pageLoaded = false;

        // If the site is configured with http:// protocol we force that one, otherwise we use default mode.
        const protocol = siteUrl.indexOf('http://') === 0 ? 'http://' : undefined;

        return this.sitesProvider.checkSite(siteUrl, protocol).then((result) => {

            this.siteChecked = true;
            this.siteUrl = result.siteUrl;

            this.siteConfig = result.config;
            this.treatSiteConfig();

            if (result && result.warning) {
                this.domUtils.showErrorModal(result.warning, true, 4000);
            }

            if (this.loginHelper.isSSOLoginNeeded(result.code)) {
                // SSO. User needs to authenticate in a browser.
                this.isBrowserSSO = true;

                // Check that there's no SSO authentication ongoing and the view hasn't changed.
                if (!this.appProvider.isSSOAuthenticationOngoing() && !this.viewLeft) {
                    this.loginHelper.confirmAndOpenBrowserForSSOLogin(
                        result.siteUrl, result.code, result.service, result.config && result.config.launchurl);
                }
            } else {
                this.isBrowserSSO = false;
            }

        }).catch((error) => {
            this.domUtils.showErrorModal(error);
        }).finally(() => {
            this.pageLoaded = true;
        });
    }

    /**
     * Treat the site configuration (if it exists).
     */
    protected treatSiteConfig(): void {
        if (this.siteConfig) {
            this.siteName = this.siteConfig.sitename;
            this.logoUrl = this.siteConfig.logourl || this.siteConfig.compactlogourl;
            this.authInstructions = this.siteConfig.authinstructions || this.translate.instant('core.login.loginsteps');
            this.canSignup = this.siteConfig.registerauth == 'email' && !this.loginHelper.isEmailSignupDisabled(this.siteConfig);
            this.identityProviders = this.loginHelper.getValidIdentityProviders(this.siteConfig);

            if (!this.eventThrown && !this.viewLeft) {
                this.eventThrown = true;
                this.eventsProvider.trigger(CoreEventsProvider.LOGIN_SITE_CHECKED, { config: this.siteConfig });
            }
        } else {
            this.siteName = null;
            this.logoUrl = null;
            this.authInstructions = null;
            this.canSignup = false;
            this.identityProviders = [];
        }
    }

    /**
     * Tries to authenticate the user.
     */
    login(): void {
        this.appProvider.closeKeyboard();

        // Get input data.
        const siteUrl = this.siteUrl,
            username = this.credForm.value.username,
            password = this.credForm.value.password;

        if (!this.siteChecked || this.isBrowserSSO) {
            // Site wasn't checked (it failed) or a previous check determined it was SSO. Let's check again.
            this.checkSite(siteUrl).then(() => {
                if (!this.isBrowserSSO) {
                    // Site doesn't use browser SSO, throw app's login again.
                    return this.login();
                }
            });

            return;
        }

        if (!username) {
            this.domUtils.showErrorModal('core.login.usernamerequired', true);

            return;
        }
        if (!password) {
            this.domUtils.showErrorModal('core.login.passwordrequired', true);

            return;
        }

        if (!this.appProvider.isOnline()) {
            this.domUtils.showErrorModal('core.networkerrormsg', true);

            return;
        }

        const modal = this.domUtils.showModalLoading();

        // Start the authentication process.
        this.sitesProvider.getUserToken(siteUrl, username, password).then((data) => {
            return this.sitesProvider.newSite(data.siteUrl, data.token, data.privateToken).then((id) => {
                // Reset fields so the data is not in the view anymore.
                this.credForm.controls['username'].reset();
                this.credForm.controls['password'].reset();

                this.siteId = id;

                if (this.urlToOpen) {
                    // There's a content link to open.
                    return this.contentLinksDelegate.getActionsFor(this.urlToOpen, undefined, username).then((actions) => {
                        const action = this.contentLinksHelper.getFirstValidAction(actions);
                        if (action && action.sites.length) {
                            // Action should only have 1 site because we're filtering by username.
                            action.action(action.sites[0]);
                        } else {
                            return this.loginHelper.goToSiteInitialPage();
                        }
                    });
                } else {
                    return this.loginHelper.goToSiteInitialPage();
                }
            });
        }).catch((error) => {
            this.loginHelper.treatUserTokenError(siteUrl, error);
        }).finally(() => {
            modal.dismiss();
        });
    }

    /**
     * Forgotten password button clicked.
     */
    forgottenPassword(): void {
        if (this.siteConfig && this.siteConfig.forgottenpasswordurl) {
            // URL set, open it.
            this.utils.openInApp(this.siteConfig.forgottenpasswordurl);

            return;
        }

        // Check if password reset can be done through the app.
        const modal = this.domUtils.showModalLoading();
        this.loginHelper.canRequestPasswordReset(this.siteUrl).then((canReset) => {
            if (canReset) {
                this.navCtrl.push('CoreLoginForgottenPasswordPage', {
                    siteUrl: this.siteUrl, username: this.credForm.value.username
                });
            } else {
                this.loginHelper.openForgottenPassword(this.siteUrl);
            }
        }).finally(() => {
            modal.dismiss();
        });
    }

    /**
     * An OAuth button was clicked.
     *
     * @param {any} provider The provider that was clicked.
     */
    oauthClicked(provider: any): void {
        if (!this.loginHelper.openBrowserForOAuthLogin(this.siteUrl, provider, this.siteConfig.launchurl)) {
            this.domUtils.showErrorModal('Invalid data.');
        }
    }

    /**
     * Signup button was clicked.
     */
    signup(): void {
        this.navCtrl.push('CoreLoginEmailSignupPage', { siteUrl: this.siteUrl });
    }
}
