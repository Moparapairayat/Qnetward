package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
	_ "time/tzdata" // timezone validation must not depend on the host's zoneinfo
	"unicode/utf8"

	"qnetward/internal/store"
)

const (
	maxBioLength      = 160
	maxPronounsLength = 40
	maxURLLength      = 200
	maxSocialLinks    = 4
)

type profileResponse struct {
	Profile   store.UserProfile `json:"profile"`
	AvatarURL string            `json:"avatar_url"`
	// AvatarUploads says whether this server can store avatar images.
	AvatarUploads bool `json:"avatar_uploads"`
}

func (srv *Server) profileResponse(ctx context.Context, userID int64, profile store.UserProfile) profileResponse {
	key, _ := srv.store.GetUserAvatarKey(ctx, userID)
	return profileResponse{Profile: profile, AvatarURL: avatarURL(userID, key), AvatarUploads: srv.store != nil}
}

type profileUpdateRequest struct {
	Bio         string   `json:"bio"`
	Pronouns    string   `json:"pronouns"`
	Website     string   `json:"website"`
	Timezone    string   `json:"timezone"`
	SocialLinks []string `json:"social_links"`
}

// handleAccountProfile reads (GET) or replaces (PUT) the signed-in user's public profile.
func (srv *Server) handleAccountProfile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPut {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}
	if r.Method == http.MethodPut && !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}
	user, ok := srv.requireAuthenticatedUser(w, r)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	if r.Method == http.MethodGet {
		profile, err := srv.store.GetUserProfile(ctx, user.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not load profile"})
			return
		}
		writeJSON(w, http.StatusOK, srv.profileResponse(ctx, user.ID, profile))
		return
	}

	if srv.isDemoUser(user) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "demo access cannot modify the shared profile"})
		return
	}
	var req profileUpdateRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	profile, err := normalizeProfile(req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	saved, err := srv.store.SaveUserProfile(ctx, user.ID, profile)
	if err != nil {
		if errors.Is(err, store.ErrUserNotFound) {
			writeJSON(w, http.StatusNotFound, apiError{Error: "user not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not save profile"})
		return
	}
	writeJSON(w, http.StatusOK, srv.profileResponse(ctx, user.ID, saved))
}

func normalizeProfile(req profileUpdateRequest) (store.UserProfile, error) {
	bio := strings.TrimSpace(req.Bio)
	if utf8.RuneCountInString(bio) > maxBioLength {
		return store.UserProfile{}, fmt.Errorf("bio must be %d characters or fewer", maxBioLength)
	}
	pronouns := strings.TrimSpace(req.Pronouns)
	if utf8.RuneCountInString(pronouns) > maxPronounsLength {
		return store.UserProfile{}, fmt.Errorf("pronouns must be %d characters or fewer", maxPronounsLength)
	}
	website, err := normalizeProfileURL(req.Website, "website")
	if err != nil {
		return store.UserProfile{}, err
	}
	timezone := strings.TrimSpace(req.Timezone)
	if timezone != "" {
		if _, err := time.LoadLocation(timezone); err != nil || timezone == "Local" {
			return store.UserProfile{}, fmt.Errorf("timezone must be an IANA zone such as Asia/Dhaka")
		}
	}

	links := make([]string, 0, len(req.SocialLinks))
	seen := map[string]bool{}
	for _, raw := range req.SocialLinks {
		link, err := normalizeProfileURL(raw, "social link")
		if err != nil {
			return store.UserProfile{}, err
		}
		if link == "" || seen[strings.ToLower(link)] {
			continue
		}
		seen[strings.ToLower(link)] = true
		links = append(links, link)
	}
	if len(links) > maxSocialLinks {
		return store.UserProfile{}, fmt.Errorf("add at most %d social links", maxSocialLinks)
	}

	return store.UserProfile{Bio: bio, Pronouns: pronouns, Website: website, Timezone: timezone, SocialLinks: links}, nil
}

// normalizeProfileURL accepts http(s) links, adding https:// when the scheme is missing.
func normalizeProfileURL(raw, field string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", nil
	}
	if !strings.Contains(value, "://") {
		value = "https://" + value
	}
	if len(value) > maxURLLength {
		return "", fmt.Errorf("%s must be %d characters or fewer", field, maxURLLength)
	}
	u, err := url.Parse(value)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || strings.ContainsAny(u.Host, " <>\"") {
		return "", fmt.Errorf("%s must be a valid http or https URL", field)
	}
	if u.User != nil {
		return "", fmt.Errorf("%s must not contain credentials", field)
	}
	return u.String(), nil
}
