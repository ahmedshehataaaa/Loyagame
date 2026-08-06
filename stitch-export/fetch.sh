#!/usr/bin/env bash
# Retrieve the McSlice Rewards Arcade exports (project 11798987857471355483).
# URLs come from the Stitch API listing, not invented. Screens marked
# CODE=none returned an empty htmlCode object — image-only, no source.
set -u
cd "$(dirname "$0")"
mkdir -p screens/{welcome,asset-library,rewards,sign-in,gameplay,leaderboard,victory} raw assets

get () {  # get <url> <out>
  if curl -L --fail --silent --show-error --retry 3 --retry-delay 2 "$1" -o "$2"; then
    # Guard: a saved HTML error page under an image/zip extension.
    if head -c 512 "$2" | grep -qi '<!doctype html\|<html' && [[ "$2" != *.html ]]; then
      echo "WARN  $2 looks like an HTML error page"; return 1
    fi
    echo "OK    $2  ($(wc -c < "$2") bytes)"
  else
    echo "FAIL  $2"; return 1
  fi
}

C="https://contribution.usercontent.google.com/download?c="
L="https://lh3.googleusercontent.com/aida/"

# ---- source code (only these three screens expose htmlCode) -------------
get "${C}CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzNhMjA1OWRjNzBmNDQ5NDZhODRlZTU5Nzg4MzU2MDNmEgsSBxD8qJef1AsYAZIBJAoKcHJvamVjdF9pZBIWQhQxMTc5ODk4Nzg1NzQ3MTM1NTQ4Mw&filename=&opi=96797242" screens/leaderboard/source.html
get "${C}CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzAwMDY1N2JkM2RiMDM0NGYwNDVhZDVmMGE4MGU2YjM2EgsSBxD8qJef1AsYAZIBJAoKcHJvamVjdF9pZBIWQhQxMTc5ODk4Nzg1NzQ3MTM1NTQ4Mw&filename=&opi=89354086" screens/asset-library/source.html
get "${C}CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzAwMDY1N2JkM2Q0NzQzZjcwOTY4OTAwZjg3MDQ3ZDlhEgsSBxD8qJef1AsYAZIBJAoKcHJvamVjdF9pZBIWQhQxMTc5ODk4Nzg1NzQ3MTM1NTQ4Mw&filename=&opi=89354086" screens/gameplay/source.html
# Victory: the requested id 1a87d2e4 is image-only, but a sibling "You Won!"
# screen (6f4be65d) does expose code — used as the victory source of truth.
get "${C}CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzAwMDY1N2JkM2I0M2YwYjUwMjNiZjNmODliMTIzNGI0EgsSBxD8qJef1AsYAZIBJAoKcHJvamVjdF9pZBIWQhQxMTc5ODk4Nzg1NzQ3MTM1NTQ4Mw&filename=&opi=89354086" screens/victory/source.html

# ---- reference screenshots (all seven) ----------------------------------
get "${L}AP1WRLtYRUD0AAQxJENhW5HzSNOm8vogEuJ-Ysv7Tywip8DDiXpjKP5TOakafx6c1LGKTI1RXHltchbX4sg-HFNuDSoY69KPHFrPSGLkzHbPAV2H40QCWpY4I15IYGL-oFZ8BrEJvG2mceva1w-uvjyhLsKrAZihbKi0EcdEOvJocIe8TbT5vn6ktBYD9G0JOnTKCkOef_wkMw4_S_DdJji357uprPxc1qyguQDPGXW1LjBaZ1Ugxx9jBrldzg" screens/welcome/reference.png
get "${L}AP1WRLtptTUgccU19aVX5VBiJ35_AiUDbttYFsOM4nn9knCcPwrBcbzAGdkyf5ulnVt4yeBX_iXGATR_sGowWdXKsHfDtcdbUXBogdwHt0dAKq1KeXT2bb9yzPTW7OgG790C4lHetX8tn7AAy5IkZ0Iz7S4a8MOcVR7WUjSDXZOIbl5iYlV8_FzlFLt1AwekuIZTANwZYEr3jFjMlnCu-r0CVi-FlbZtG4WTkgKcJxdud-BzCEpnn6FSJkkPtJC8" screens/sign-in/reference.png
get "${L}AP1WRLs7_RJy0F0TJxXnt2Jf8-VHQSWCpAiudg61PScHaJh9nFjAX2_ak24QQOgY4Gaeq4psQAKF4aIhXN4ozzcDUSvqUhH7Fvm1A4MRTsyUAstwQ0_EBHT5elbSrfIxQTinbm81dCXMHlb1sHsS3yjbjgpvfMTkCnCVETvVL5YcgIVo_N3tiCsLoQiQ2Rrodi08LFosHyn2UZ44H9k8K4FTOxlCqEYcCBg-aUpJkh-qpbWm9cSo444OxoA1pFk" screens/rewards/reference.png
get "${L}AP1WRLtE5L3OOli1BiUyxrjyKctsqMMMC8KQ9hN8gZ4wIz2ayznVT1VL5sKTA0-IjGXwrxeGbOtzWRhTIXrUYu0mEEjTDyTSCUofLDjvU3W45nHw3UqqkHVTg6vp9wJgL1wmvBoCcilzrFywY3oSHp5sfWEVTk8cJAdjWzX-iCUR3ASng60cF4VW8IFXXwO1MZfPh5rkTchsyyX-oq9BVZ0TI1eo6WIsH5852ln_OwxUSeItIRmgqrW5DTEiGirw" screens/victory/reference.png
get "${L}AP1WRLsLCNkluFHk8AsRRruL9p7_pe3UjESBlKyYa2vhVvnr5c2mOwED2N9o1EGG32uk9eon9TtfCm-lypP05sEHcgpuKQJWZhOiIRPNglfyYk2H-XYvVEmlqh9bvYg-FHhEW84fKgNCAmFINfJGBtvY0ZoOL-Qy75UNubntLT5a-b7H9sE445zouCxSTb4darGs8lsidylqlJbHAENZpmCN5NR1gVU6e3Pky9d6_y9Fsm_6Xe4d88yKkxEKfDuD" screens/gameplay/reference.png
get "${L}AP1WRLtDMEu_8_eDmmfSSirOt52fntnJz4CSelXmaDG4D9B4nobSGoWlr8vVyDjL3iwqynCm-NcN4nEtZ_pum24O5NVHDcgH3L877vWXr_-v5key8r4rm705PoSm9Nog0MiRSfvXr7-wcxYnJ-sMy862RTvWC133DmOFwEue3Zdpj39GWPBAZ3LBcrFd-38CNLsNE70gxFvJQXc2lJEaC2QPJfGvKE0CgjrYxXfwzmer-XMH4S4P3T2gokLAY_4" screens/leaderboard/reference.png
get "${L}AP1WRLsmY-QRg10zszh5ATo3buUswgc84OVlsxpb89vKR4PuICyy_C5L7xCk9X0QL00kCSqbtMvk-O6OeyUvP8d8QG4Up5RYCjPrQNemcnbbSzZXZUXRL8GOw7K703yLDJboPVosrIOmmeqAb7RdMI4WbNV7tgpg7gi69wv2C2yJuY3t6PhvyPooA054991XU0BUkPsEiuWpd33UuudKFMvXdVAWL_9_Dc5EK6Z34QMugF1mmh1JMPXHA1gYwdZZ" screens/asset-library/reference.png

# ---- extra art referenced by the project --------------------------------
get "${L}AP1WRLsI1gR5YtVfDivVrG8-Zy38K44sLwC-JHNCFhEcRKJKsToGISoCpDghDS80esMbCpmyzchiJXHX2I_O4qFcoSDQ4wBdY99rhwGckSBGuCPfNQI7VyTc3Vnkr7AcKRA0rtOKIIjGwSSMzblfssauknieO3CPhuPoq9F9WbRoh98qPmN2o4IB9fTv8peowPXQmcS5cYl3Ays1z-ZqqBDe2p8ZnDkRUY_FB5wScr0_sCuSzFGw6waGfUrkbf0Q" raw/gameplay-art.png
get "${L}AP1WRLs6KNMz2Hh0kZuZ1G2mTpN_hGbfNUiYiJd4RPW3yAOAis0cqJdyzuw9lrI4E69C2PyYz7SktlfCQszvoV-yfdWc1IEYr8cer0ZbYZeSvpj84nyd_SaUXUZKBobl3feAfM8xqyFjF957wghY_tpTv3O--u5VGMMnKiqlTUW6lOBZGOYJsua0Sg3GMrD1OOjS46Rlz1S6M4Ay7yiEZKS7eTyuKtcWOlGGS4k2GYGeI8Hd3dUgBlEYE9Pf9dN_" raw/avatar.png

echo "--- done ---"
