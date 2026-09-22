plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

fun String.escapeForBuildConfig(): String = replace("\\", "\\\\").replace("\"", "\\\"")

val webShellUrl =
    (findProperty("WEB_SHELL_URL") as String?)
        ?.trim()
        ?.ifBlank { null }
        ?: "https://www.solanacity.io/"
val webShellApplicationId =
    (findProperty("WEB_SHELL_APPLICATION_ID") as String?)
        ?.trim()
        ?.ifBlank { null }
        ?: "io.solanacity.app"
val webShellVersionCode =
    (findProperty("WEB_SHELL_VERSION_CODE") as String?)
        ?.trim()
        ?.ifBlank { null }
        ?.toIntOrNull()
        ?: 1
val webShellVersionName =
    (findProperty("WEB_SHELL_VERSION_NAME") as String?)
        ?.trim()
        ?.ifBlank { null }
        ?: "1.0"
val webShellSigningStoreFile =
    (findProperty("WEB_SHELL_SIGNING_STORE_FILE") as String?)
        ?.trim()
        ?.ifBlank { null }
val webShellSigningStorePassword =
    (findProperty("WEB_SHELL_SIGNING_STORE_PASSWORD") as String?)
        ?.trim()
        ?.ifBlank { null }
        ?: System
            .getenv("WEB_SHELL_SIGNING_STORE_PASSWORD")
            ?.trim()
            ?.ifBlank { null }
val webShellSigningKeyAlias =
    (findProperty("WEB_SHELL_SIGNING_KEY_ALIAS") as String?)
        ?.trim()
        ?.ifBlank { null }
val webShellSigningKeyPassword =
    (findProperty("WEB_SHELL_SIGNING_KEY_PASSWORD") as String?)
        ?.trim()
        ?.ifBlank { null }
        ?: System
            .getenv("WEB_SHELL_SIGNING_KEY_PASSWORD")
            ?.trim()
            ?.ifBlank { null }
val hasReleaseSigning =
    webShellSigningStoreFile != null &&
        webShellSigningStorePassword != null &&
        webShellSigningKeyAlias != null

android {
    namespace = "io.solanacity.app"
    compileSdk {
        version = release(36)
    }

    defaultConfig {
        applicationId = webShellApplicationId
        minSdk = 28
        targetSdk = 36
        versionCode = webShellVersionCode
        versionName = webShellVersionName

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField("String", "WEB_SHELL_URL", "\"${webShellUrl.escapeForBuildConfig()}\"")
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("webShellRelease") {
                storeFile = file(webShellSigningStoreFile!!)
                storePassword = webShellSigningStorePassword
                keyAlias = webShellSigningKeyAlias
                keyPassword = webShellSigningKeyPassword ?: webShellSigningStorePassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("webShellRelease")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    debugImplementation(libs.androidx.compose.ui.tooling)
}
