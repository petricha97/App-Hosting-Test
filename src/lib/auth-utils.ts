import { adminAuth } from "@/app/lib/firestore";
import { FirebaseAuthError } from "firebase-admin/auth";

interface DecodedUser {
    uid: string;
    name: string;
    picture: string;
    email: string;
    // add more as needed.
}
interface UserError {
    error: "USER_DISABLED" | "TOKEN_EXPIRED" | "UNEXPECTED_ERROR";
}

type DecodeUserResult = DecodedUser | UserError;

/**
 * Decodes a Firebase Authentication token and returns a user object
 * containing their uid, name, picture, and email, or an error object
 * with a specific error code.
 *
 * @param {string} token - The Firebase Authentication token to decode.
 *
 * @returns {Promise<DecodeUserResult>} A promise resolving a user object or
 * an error object.
 *
 * @throws {UserError} If the token is invalid or the user account is disabled.
 */
export default async function decodeUser(token: string): Promise<DecodeUserResult> {
    let decoded;

    try {
        decoded = await adminAuth.verifyIdToken(token);
        const uid = decoded.uid ?? "No uid";
        const name = decoded.name ?? "No name";
        const picture = decoded.picture ?? "No picture";
        const email = decoded.email ?? "No email";
        return {
            uid: uid,
            name: name,
            picture: picture,
            email: email
        }
    } catch (error: unknown) {
        const userError: UserError = { error: "UNEXPECTED_ERROR" };
        // Safe type guarding: check if it's a FirebaseError
        if (error instanceof Error && 'code' in error) {
            const firebaseError = error as FirebaseAuthError;

            if (firebaseError.code === 'auth/user-disabled') {
                console.error("Account disabled.");
                userError.error = "USER_DISABLED";
                return userError;
            }

            if (firebaseError.code === 'auth/id-token-expired') {
                userError.error = "TOKEN_EXPIRED";
                return userError;
            }
        }
        console.error("Unexpected error:", error);
        return userError;
    }
}